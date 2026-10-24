"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CheckCircle, Circle, RocketLaunch } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ConfirmDialog, Dialog } from "@/components/dashboard/Dialog";
import { OwnerOnlyNotice } from "@/components/dashboard/settings/OwnerOnly";
import { Badge, Button, Card, CardHeader, Notice, Skeleton } from "@/components/dashboard/primitives";
import { confirmAgreements, parseUtc, setInstitutionMode, type ChecklistItem } from "@/lib/fable/console";
import { useFableStore } from "@/lib/fable/store";
import { useOnboarding, usePermissions } from "@/lib/fable/useConsole";

/** Where each checklist item is done. Agreements are confirmed on this page. */
const WHERE: Record<string, string> = {
  api_key: "/dashboard/settings/developers",
  webhook: "/dashboard/settings/developers",
  policy: "/dashboard/settings/policy",
  customers: "/dashboard/settings/data",
  history: "/dashboard/settings/data",
  team: "/dashboard/settings/team",
  branding: "/dashboard/settings/branding",
};

/** The go-live checklist, the owner's agreements confirmation, and the switch itself. */
export default function GoLivePage() {
  const store = useFableStore();
  const institutionId = store?.session.institutionId ?? "";
  const { canManage } = usePermissions();
  const { data, mutate } = useOnboarding();
  const [agreeing, setAgreeing] = useState(false);
  const [target, setTarget] = useState<"sandbox" | "live" | null>(null);
  const [busy, setBusy] = useState(false);

  if (!data) {
    return <Card><Skeleton className="h-64" /></Card>;
  }

  const live = data.mode === "live";
  const required = data.items.filter((i) => i.required);
  const recommended = data.items.filter((i) => !i.required);

  async function switchMode() {
    if (!target) return;
    setBusy(true);
    try {
      await setInstitutionMode(institutionId, target);
      toast.success(target === "live" ? "You're live" : "Back in sandbox");
      setTarget(null);
      mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the mode.");
      setTarget(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <OwnerOnlyNotice />
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardHeader
            title={live ? "You're live" : "Going live"}
            subtitle={
              live
                ? "Every transfer must carry your API key, sent from your own servers. The sandbox app is off."
                : "Finish the required items, then switch. Until then, your team can try Fable in the sandbox app with test customers."
            }
          />
          <Badge tone={live ? "success" : "warning"}>{live ? "Live" : "Sandbox"}</Badge>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-d-surface-2">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(data.done / Math.max(data.total, 1)) * 100}%` }} />
          </div>
          <span className="shrink-0 text-[13px] font-semibold tabular-nums text-d-text">{data.done} of {data.total}</span>
        </div>
        {canManage && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {live ? (
              <Button variant="secondary" onClick={() => setTarget("sandbox")}>Switch back to sandbox</Button>
            ) : (
              <Button icon={<RocketLaunch size={16} />} disabled={!data.ready_to_go_live} onClick={() => setTarget("live")}>
                Go live
              </Button>
            )}
            {!live && !data.ready_to_go_live && (
              <span className="text-[13px] text-d-muted">
                {data.required_remaining.length} required item{data.required_remaining.length === 1 ? "" : "s"} left
              </span>
            )}
          </div>
        )}
      </Card>

      <Card padded={false}>
        <div className="p-5 pb-2"><CardHeader title="Required" subtitle="Going live is refused until each of these is done." /></div>
        <Items items={required} canManage={canManage} onAgree={() => setAgreeing(true)} agreements={data.agreements} />
      </Card>
      <Card padded={false}>
        <div className="p-5 pb-2"><CardHeader title="Recommended" subtitle="Not required, but Fable works better with them." /></div>
        <Items items={recommended} canManage={canManage} onAgree={() => setAgreeing(true)} agreements={data.agreements} />
      </Card>

      <AgreementsDialog open={agreeing} onClose={() => setAgreeing(false)} onDone={() => mutate()} />
      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        onConfirm={switchMode}
        busy={busy}
        tone={target === "sandbox" ? "danger" : "primary"}
        title={target === "live" ? "Go live?" : "Switch back to sandbox?"}
        description={
          target === "live"
            ? "From now on, only requests with your API key can score transfers or act on your customers. Make sure your servers send it first. The sandbox app switches off."
            : "The sandbox app works again for your team's test customers. Requests with your API key keep working. Only do this while you are still testing."
        }
        confirmLabel={target === "live" ? "Go live" : "Switch to sandbox"}
      />
    </div>
  );
}

function Items({ items, canManage, onAgree, agreements }: {
  items: ChecklistItem[];
  canManage: boolean;
  onAgree: () => void;
  agreements: { confirmed_at: string | null; confirmed_by: string | null };
}) {
  return (
    <ul className="divide-y divide-d-border border-t border-d-border">
      {items.map((item) => {
        const href = WHERE[item.key];
        const body = (
          <>
            {item.done ? (
              <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-emerald-500" />
            ) : (
              <Circle size={20} className="mt-0.5 shrink-0 text-d-faint" />
            )}
            <div className="min-w-0 flex-1">
              <p className={`text-[14px] font-semibold ${item.done ? "text-d-muted" : "text-d-text"}`}>{item.label}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-d-muted">
                {item.key === "agreements" && agreements.confirmed_at
                  ? `Confirmed by ${agreements.confirmed_by ?? "an owner"} on ${new Date(parseUtc(agreements.confirmed_at) ?? 0).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}.`
                  : item.detail}
              </p>
            </div>
          </>
        );
        if (item.key === "agreements") {
          return (
            <li key={item.key} className="flex items-start gap-3 px-5 py-3.5">
              {body}
              {!item.done && canManage && <Button size="sm" onClick={onAgree}>Confirm</Button>}
            </li>
          );
        }
        return (
          <li key={item.key}>
            <Link href={href ?? "#"} className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-d-surface-2">
              {body}
              <ArrowRight size={16} className="mt-1 shrink-0 text-d-faint" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** An owner records that the DPA and DPIA are in place. Fable keeps who and when. */
function AgreementsDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [dpa, setDpa] = useState(false);
  const [dpia, setDpia] = useState(false);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      await confirmAgreements();
      toast.success("Recorded");
      onDone();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record the confirmation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Confirm the agreements"
      description="Under the NDPA 2023, Fable processes your customers' data on your behalf. Before going live, an owner confirms both of these are in place."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!dpa || !dpia} onClick={go}>Confirm</Button></>}>
      <div className="flex flex-col gap-3">
        <Check checked={dpa} onChange={setDpa}>
          A data processing agreement between my institution and Fable is signed.
        </Check>
        <Check checked={dpia} onChange={setDpia}>
          My institution has completed a data protection impact assessment (DPIA) that covers its use of Fable.
        </Check>
        <Notice tone="neutral">Your name and the time are recorded in the audit log.</Notice>
      </div>
    </Dialog>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-d-border p-3 text-[13px] leading-relaxed text-d-text">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-primary)]" />
      <span>{children}</span>
    </label>
  );
}
