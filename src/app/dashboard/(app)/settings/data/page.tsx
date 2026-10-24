"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, CheckCircle, DownloadSimple, FileCsv, UploadSimple, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Dialog } from "@/components/dashboard/Dialog";
import { OwnerOnlyNotice } from "@/components/dashboard/settings/OwnerOnly";
import { Badge, Button, Card, CardHeader, Field, Notice, Skeleton, inputClass, table } from "@/components/dashboard/primitives";
import {
  applyImport,
  discardImport,
  downloadTemplate,
  importJob,
  resetSandbox,
  uploadImport,
  type ImportJob,
  type ImportKind,
} from "@/lib/fable/console";
import { useImportJobs, useImportSummary, useOnboarding, usePermissions } from "@/lib/fable/useConsole";
import { useFableStore } from "@/lib/fable/store";

const KINDS: { kind: ImportKind; title: string; body: string }[] = [
  {
    kind: "customers",
    title: "Customers",
    body: "Your customers by your own reference (account or CIF number), with optional name, phone, email and segment. Mark sandbox-only people as test.",
  },
  {
    kind: "transactions",
    title: "Past transfers",
    body: "Completed transfers, so each customer starts with a baseline instead of cold. Import customers first. Narrations are not needed and are not stored.",
  },
];

/** Bringing an institution's customers and history in, and resetting the sandbox. */
export default function DataSettingsPage() {
  const { canManage } = usePermissions();
  const { data: summary, mutate: refreshSummary } = useImportSummary();
  const { data: jobs, mutate: refreshJobs } = useImportJobs();
  const { data: onboarding } = useOnboarding();

  function refresh() {
    refreshSummary();
    refreshJobs();
  }

  return (
    <div className="flex flex-col gap-4">
      <OwnerOnlyNotice />
      <Card>
        <CardHeader title="What Fable holds" subtitle="Your data, by your references. Nothing here came from Fable." />
        {summary ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Customers" value={summary.customers.total} />
            <Figure label="Real customers" value={summary.customers.real} />
            <Figure label="Test customers" value={summary.customers.test} />
            <Figure label="Past transfers" value={summary.history.transfers} />
          </div>
        ) : (
          <Skeleton className="h-16" />
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {KINDS.map((k) => (
          <ImportCard key={k.kind} {...k} canManage={canManage} onDone={refresh} />
        ))}
      </div>

      <Card padded={false}>
        <div className="p-5 pb-0">
          <CardHeader title="Import history" subtitle="Every upload, newest first." />
        </div>
        {!jobs ? (
          <div className="p-5"><Skeleton className="h-20" /></div>
        ) : jobs.imports.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-d-muted">No imports yet.</p>
        ) : (
          <div className={table.wrap}>
            <table className={table.base}>
              <thead>
                <tr className={table.head}>
                  <th className={table.th}>File</th>
                  <th className={table.th}>Kind</th>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Added</th>
                  <th className={table.th}>Skipped</th>
                  <th className={table.th}>Rejected</th>
                  <th className={table.th}>By</th>
                </tr>
              </thead>
              <tbody>
                {jobs.imports.map((j) => (
                  <tr key={j.id} className={table.row}>
                    <td className={`${table.td} max-w-[220px] truncate font-medium text-d-text`}>{j.filename}</td>
                    <td className={table.td}>{j.kind === "customers" ? "Customers" : "Past transfers"}</td>
                    <td className={table.td}><StatusBadge status={j.status} /></td>
                    <td className={`${table.td} tabular-nums`}>{j.inserted.toLocaleString("en-NG")}</td>
                    <td className={`${table.td} tabular-nums`}>{j.skipped.toLocaleString("en-NG")}</td>
                    <td className={`${table.td} tabular-nums`}>{j.invalid.toLocaleString("en-NG")}</td>
                    <td className={`${table.td} text-d-muted`}>{j.created_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage && onboarding?.mode !== "live" && <SandboxReset onDone={refresh} />}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-d-surface-2 px-4 py-3">
      <p className="text-[12px] text-d-muted">{label}</p>
      <p className="mt-0.5 text-[20px] font-bold tabular-nums text-d-text">{value.toLocaleString("en-NG")}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: ImportJob["status"] }) {
  const map = {
    validated: { tone: "warning", label: "Waiting to apply" },
    applying: { tone: "brand", label: "Applying" },
    completed: { tone: "success", label: "Done" },
    failed: { tone: "danger", label: "Failed" },
    discarded: { tone: "neutral", label: "Discarded" },
  } as const;
  const s = map[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** One kind of import: template, upload, review, apply. */
function ImportCard({ kind, title, body, canManage, onDone }: {
  kind: ImportKind; title: string; body: string; canManage: boolean; onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // While an import applies in the background, follow its progress.
  useEffect(() => {
    if (job?.status !== "applying") return;
    const timer = setInterval(async () => {
      try {
        const next = await importJob(job.id);
        setJob(next);
        if (next.status !== "applying") {
          onDone();
          if (next.status === "completed") toast.success(`${title}: ${next.inserted.toLocaleString("en-NG")} added`);
          else toast.error(`${title}: the import failed`);
        }
      } catch {
        // A blip; try again on the next tick.
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [job, onDone, title]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      setJob(await uploadImport(kind, file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function apply() {
    if (!job) return;
    setBusy(true);
    try {
      setJob(await applyImport(job.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not apply.");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!job) return;
    await discardImport(job.id).catch(() => undefined);
    setJob(null);
    onDone();
  }

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={title}
        action={
          <Button size="sm" variant="ghost" icon={<DownloadSimple size={14} />}
            onClick={() => downloadTemplate(kind).catch((e) => toast.error(e.message))}>
            Template
          </Button>
        }
      />
      <p className="text-[13px] leading-relaxed text-d-muted">{body}</p>

      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}

      {!job || job.status === "discarded" ? (
        <button
          type="button"
          disabled={!canManage || busy}
          onClick={() => input.current?.click()}
          className="mt-4 flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-d-border bg-d-surface-2 px-4 py-8 text-center transition-colors hover:border-brand/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FileCsv size={28} className="text-brand" />
          <span className="text-[14px] font-semibold text-d-text">{busy ? "Checking the file..." : "Upload a CSV"}</span>
          <span className="text-[12px] text-d-muted">Up to 50,000 rows or 10 MB. Nothing changes until you confirm.</span>
        </button>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold text-d-text">{job.filename}</span>
            <StatusBadge status={job.status} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Figure label="Rows" value={job.total} />
            <Figure label="Ready" value={job.valid} />
            <Figure label="Rejected" value={job.invalid} />
          </div>
          {job.status === "applying" && (
            <div className="h-2 overflow-hidden rounded-full bg-d-surface-2">
              <div className="h-full bg-brand transition-all" style={{ width: `${Math.min(100, ((job.inserted + job.skipped) / Math.max(job.valid, 1)) * 100)}%` }} />
            </div>
          )}
          {job.status === "completed" && (
            <Notice tone="success">
              <CheckCircle size={14} weight="fill" className="mr-1 inline" />
              {job.inserted.toLocaleString("en-NG")} added, {job.skipped.toLocaleString("en-NG")} already there.
            </Notice>
          )}
          {!!job.errors?.length && (
            <details className="rounded-xl border border-d-border">
              <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-d-text">
                <Warning size={14} className="mr-1 inline text-amber-500" />
                {job.errors.length} problem{job.errors.length === 1 ? "" : "s"} to fix
              </summary>
              <ul className="max-h-56 overflow-y-auto border-t border-d-border text-[12px]">
                {job.errors.map((e, n) => (
                  <li key={n} className="flex gap-3 border-b border-d-border px-3 py-1.5 last:border-0">
                    <span className="w-16 shrink-0 tabular-nums text-d-faint">Line {e.line ?? "-"}</span>
                    <span className="w-32 shrink-0 font-mono text-d-text">{e.field}</span>
                    <span className="text-d-muted">{e.message}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {job.status === "validated" ? (
              <>
                <Button variant="secondary" onClick={discard}>Discard</Button>
                <Button loading={busy} disabled={!job.valid} onClick={apply} icon={<UploadSimple size={16} />}>
                  Import {job.valid.toLocaleString("en-NG")} row{job.valid === 1 ? "" : "s"}
                </Button>
              </>
            ) : job.status !== "applying" ? (
              <Button variant="secondary" onClick={() => setJob(null)}>Upload another</Button>
            ) : null}
          </div>
        </div>
      )}
      <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => pick(e.target.files?.[0])} />
    </Card>
  );
}

/** Remove every test customer and what they did. Real customers stay. */
function SandboxReset({ onDone }: { onDone: () => void }) {
  const store = useFableStore();
  const institutionId = store?.session.institutionId ?? "";
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const r = await resetSandbox(confirm.trim());
      toast.success(`Removed ${r.customers_removed} test customer${r.customers_removed === 1 ? "" : "s"} and their activity`);
      setOpen(false);
      setConfirm("");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-red-500/30">
      <CardHeader title="Reset the sandbox" subtitle="Remove every test customer and everything they did. Real customers, your team, keys and settings stay." />
      <Button variant="danger" icon={<ArrowCounterClockwise size={16} />} onClick={() => setOpen(true)}>Reset sandbox data</Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title="Reset the sandbox?"
        description="Test customers, their transfers, holds, balances and verification set-up are removed. This can't be undone."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" loading={busy} disabled={confirm.trim() !== institutionId} onClick={go}>Reset</Button></>}>
        <Field label={`Type ${institutionId} to confirm`}>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} autoComplete="off" spellCheck={false} />
        </Field>
      </Dialog>
    </Card>
  );
}
