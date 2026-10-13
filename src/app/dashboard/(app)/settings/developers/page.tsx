"use client";

import { useEffect, useState } from "react";
import { ArrowsClockwise, Check, Copy, Plus, PaperPlaneTilt, Trash, WebhooksLogo } from "@phosphor-icons/react";
import { ConfirmDialog, Dialog } from "@/components/dashboard/Dialog";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Notice,
  Skeleton,
  TextInput,
} from "@/components/dashboard/primitives";
import { institutionCredentials, type InstitutionCredentials } from "@/lib/fable/api";
import {
  createWebhook,
  deleteWebhook,
  parseUtc,
  rotateApiKey,
  setInstitutionMode,
  testWebhook,
  type WebhookEndpoint,
} from "@/lib/fable/console";
import { formatRelativeTime } from "@/lib/fable/format";
import { useFableStore } from "@/lib/fable/store";
import { usePermissions, useWebhookDeliveries, useWebhooks } from "@/lib/fable/useConsole";

const EVENT_HELP: Record<string, string> = {
  "transaction.flagged": "Shield asked a customer to verify",
  "transaction.blocked": "Shield stopped a transfer",
  "containment.created": "Ghost is holding a transfer",
  "containment.resolved": "A hold was released or cancelled",
  "case.resolved": "An analyst closed a case as fraud or legitimate",
};

function when(v: string | null | undefined) {
  const t = parseUtc(v);
  return t ? formatRelativeTime(t) : "-";
}

export default function DevelopersPage() {
  const store = useFableStore();
  const institutionId = store?.session.institutionId ?? null;
  return (
    <>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <ApiKeyCard institutionId={institutionId} />
        <ModeCard institutionId={institutionId} />
      </div>
      <WebhooksCard />
    </>
  );
}

function useCredentials(institutionId: string | null) {
  const [creds, setCreds] = useState<InstitutionCredentials | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!institutionId) return;
    let cancelled = false;
    institutionCredentials(institutionId)
      .then((c) => !cancelled && setCreds(c))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [institutionId, version]);
  return { creds, failed, reload: () => setVersion((v) => v + 1) };
}

function CopyButton({ value, label = "Copy" }: { value: string | null | undefined; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={!value}
      icon={copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
      onClick={() => {
        if (!value) return;
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

function ApiKeyCard({ institutionId }: { institutionId: string | null }) {
  const { creds, failed, reload } = useCredentials(institutionId);
  const { canManage } = usePermissions();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function rotate() {
    if (!institutionId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await rotateApiKey(institutionId);
      setFresh(res.api_key);
      setConfirming(false);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rotate the key.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="API key" subtitle="Authenticates your servers' calls to Fable." />
      <div className="flex items-center gap-2 rounded-xl bg-d-surface-2 py-2 pl-4 pr-2">
        <code className="flex-1 truncate text-[13px] text-d-text">
          {creds?.masked_key ?? (failed ? "Unavailable, the API is offline" : "Loading...")}
        </code>
      </div>
      {creds?.created_at && <p className="mt-2 text-[12px] text-d-faint">Issued {when(creds.created_at)}</p>}
      <p className="mt-3 text-[12px] leading-relaxed text-d-muted">
        For security, Fable stores only a fingerprint of your key, so the full key is shown once: when it is issued or
        rotated. Lost it? {canManage ? "Rotate it to get a new one." : "Ask an owner to rotate it."} Keep it on your
        servers, never in a mobile app or a web page.
      </p>
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      <div className="mt-4 flex flex-wrap gap-2">
        {canManage && (
          <Button variant="secondary" size="sm" icon={<ArrowsClockwise size={14} />} onClick={() => setConfirming(true)}>
            Rotate key
          </Button>
        )}
        <ButtonLink href="/docs#integration" variant="ghost" size="sm">
          Integration guide
        </ButtonLink>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={rotate}
        busy={busy}
        tone="danger"
        title="Rotate the API key?"
        description="A new key is issued and the current one stops working immediately. Any server still using the old key will be refused until you update it."
        confirmLabel="Rotate now"
      />

      <Dialog
        open={Boolean(fresh)}
        onClose={() => setFresh(null)}
        title="Your new API key"
        description="Copy it now and store it in your secrets manager. For security it is not shown in full again."
        footer={<Button onClick={() => setFresh(null)}>I&apos;ve saved it</Button>}
      >
        <div className="flex items-center gap-2 rounded-xl bg-d-surface-2 py-2 pl-4 pr-2">
          <code className="flex-1 break-all text-[13px] text-d-text">{fresh}</code>
          <CopyButton value={fresh} />
        </div>
      </Dialog>
    </Card>
  );
}

function ModeCard({ institutionId }: { institutionId: string | null }) {
  const { creds, reload } = useCredentials(institutionId);
  const { canManage } = usePermissions();
  const [target, setTarget] = useState<"sandbox" | "live" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mode = creds?.mode ?? "sandbox";

  async function apply() {
    if (!institutionId || !target) return;
    setBusy(true);
    setError(null);
    try {
      await setInstitutionMode(institutionId, target);
      setTarget(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the mode.");
      setTarget(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <CardHeader title="Environment" subtitle="Who may send transactions for your institution." />
        <Badge tone={mode === "live" ? "success" : "warning"}>{mode === "live" ? "Live" : "Sandbox"}</Badge>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ModeOption
          active={mode === "sandbox"}
          title="Sandbox"
          body="Open to the demo bank. Anyone with your demo link can make test transfers."
        />
        <ModeOption
          active={mode === "live"}
          title="Live"
          body="Every transfer must carry your API key. The public demo bank can no longer write to you."
        />
      </div>
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      {canManage && (
        <div className="mt-4">
          <Button variant={mode === "live" ? "secondary" : "primary"} size="sm" onClick={() => setTarget(mode === "live" ? "sandbox" : "live")}>
            {mode === "live" ? "Switch back to sandbox" : "Go live"}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        onConfirm={apply}
        busy={busy}
        tone={target === "sandbox" ? "danger" : "primary"}
        title={target === "live" ? "Go live?" : "Switch back to sandbox?"}
        description={
          target === "live"
            ? "From now on, only requests with your API key can score transfers for your institution. Make sure your servers send it first. The demo bank will stop accepting new transfers."
            : "Anyone with your demo link will be able to send test transfers again, without a key. Only do this for a demo or test institution."
        }
        confirmLabel={target === "live" ? "Go live" : "Switch to sandbox"}
      />
    </Card>
  );
}

function ModeOption({ active, title, body }: { active: boolean; title: string; body: string }) {
  return (
    <div className={`rounded-xl border p-3.5 ${active ? "border-brand/40 bg-brand/[0.06]" : "border-d-border"}`}>
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-d-text">
        {active && <Check size={14} weight="bold" className="text-brand" />}
        {title}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-d-muted">{body}</p>
    </div>
  );
}

function WebhooksCard() {
  const { data, error, isLoading, mutate } = useWebhooks();
  const { canManage } = usePermissions();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<WebhookEndpoint | null>(null);
  const [logFor, setLogFor] = useState<WebhookEndpoint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function test(h: WebhookEndpoint) {
    setBusy(h.id);
    setMsg(null);
    try {
      const r = await testWebhook(h.id);
      setMsg(
        r.ok
          ? { tone: "success", text: `Test delivered to ${h.url} (HTTP ${r.status_code}).` }
          : { tone: "danger", text: `Test failed: ${r.error ?? (r.status_code ? `HTTP ${r.status_code}` : "no response")}.` },
      );
      await mutate();
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "The test could not be sent." });
    } finally {
      setBusy(null);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy("remove");
    try {
      await deleteWebhook(removing.id);
      await mutate();
      setRemoving(null);
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Could not remove it." });
      setRemoving(null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card padded={false}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <CardHeader title="Webhooks" subtitle="Fable pushes decisions to your systems the moment they happen, signed so you can trust them." />
        {canManage && (
          <Button icon={<Plus size={16} weight="bold" />} onClick={() => setAdding(true)}>
            Add endpoint
          </Button>
        )}
      </div>
      {msg && (
        <div className="px-5 pb-3">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
      {error ? (
        <div className="p-5 pt-0">
          <Notice tone="danger">{error.message}</Notice>
        </div>
      ) : isLoading && !data ? (
        <div className="p-5 pt-0">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !data || data.endpoints.length === 0 ? (
        <EmptyState
          icon={<WebhooksLogo size={22} />}
          title="No endpoints yet"
          body="Add one to get blocks, holds and case outcomes in your own case-management or core banking system."
        />
      ) : (
        <ul className="divide-y divide-d-border border-t border-d-border">
          {data.endpoints.map((h) => {
            const last = h.last_delivery;
            return (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[13px] text-d-text">{h.url}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {h.events.map((e) => (
                      <Badge key={e}>{e}</Badge>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[12px] text-d-faint">
                    {last ? (
                      <>
                        Last delivery {when(last.created_at)}:{" "}
                        <span className={last.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}>
                          {last.ok ? `delivered (${last.status_code})` : last.error || `failed (${last.status_code})`}
                        </span>
                      </>
                    ) : (
                      "Nothing delivered yet"
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setLogFor(h)}>
                    Log
                  </Button>
                  {canManage && (
                    <>
                      <Button variant="secondary" size="sm" icon={<PaperPlaneTilt size={14} />} loading={busy === h.id} onClick={() => test(h)}>
                        Send test
                      </Button>
                      <Button variant="ghost" size="sm" className="!text-red-500" icon={<Trash size={14} />} onClick={() => setRemoving(h)}>
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AddWebhookDialog open={adding} events={data?.events ?? Object.keys(EVENT_HELP)} onClose={() => setAdding(false)} onAdded={() => void mutate()} />
      <DeliveryLog endpoint={logFor} onClose={() => setLogFor(null)} />
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        busy={busy === "remove"}
        tone="danger"
        title="Remove this endpoint?"
        description={`Fable will stop sending events to ${removing?.url ?? "it"}.`}
        confirmLabel="Remove"
      />
    </Card>
  );
}

function AddWebhookDialog({
  open,
  events,
  onClose,
  onAdded,
}: {
  open: boolean;
  events: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<string[]>(events);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  function close() {
    setUrl("");
    setChosen(events);
    setError(null);
    setSecret(null);
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await createWebhook(url.trim(), chosen);
      setSecret(res.secret);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the endpoint.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={secret ? "Endpoint added" : "Add a webhook endpoint"}
      description={secret ? "Use this secret to verify the Fable-Signature header on every delivery. It is shown only once." : "Fable sends a signed JSON POST to this URL for each event you choose."}
      footer={
        secret ? (
          <Button onClick={close}>I&apos;ve saved the secret</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="webhook-form" loading={busy} disabled={!url.trim() || chosen.length === 0}>
              Add endpoint
            </Button>
          </>
        )
      }
    >
      {secret ? (
        <div className="flex items-center gap-2 rounded-xl bg-d-surface-2 py-2 pl-4 pr-2">
          <code className="flex-1 break-all text-[13px] text-d-text">{secret}</code>
          <CopyButton value={secret} />
        </div>
      ) : (
        <form id="webhook-form" onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Endpoint URL" hint="Must be public https.">
            <TextInput type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://risk.yourbank.ng/fable" required autoFocus />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[12px] font-semibold text-d-muted">Events</legend>
            {events.map((ev) => {
              const on = chosen.includes(ev);
              return (
                <label key={ev} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 ${on ? "border-brand/40 bg-brand/[0.05]" : "border-d-border"}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => setChosen((c) => (on ? c.filter((x) => x !== ev) : [...c, ev]))}
                    className="mt-0.5 accent-[var(--brand-primary)]"
                  />
                  <span>
                    <span className="block font-mono text-[12px] text-d-text">{ev}</span>
                    <span className="block text-[12px] text-d-muted">{EVENT_HELP[ev] ?? ""}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          {error && <Notice tone="danger">{error}</Notice>}
        </form>
      )}
    </Dialog>
  );
}

function DeliveryLog({ endpoint, onClose }: { endpoint: WebhookEndpoint | null; onClose: () => void }) {
  const { data, isLoading } = useWebhookDeliveries(endpoint?.id ?? null);
  return (
    <Dialog open={Boolean(endpoint)} onClose={onClose} size="lg" title="Delivery log" description={endpoint?.url}>
      {isLoading && !data ? (
        <Skeleton className="h-40 w-full" />
      ) : !data || data.deliveries.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-d-muted">Nothing has been sent to this endpoint yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-d-border">
          {data.deliveries.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2.5 text-[13px]">
              <Badge tone={d.ok ? "success" : "danger"}>{d.ok ? "Delivered" : "Failed"}</Badge>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-d-text">{d.event}</span>
              <span className="shrink-0 text-[12px] text-d-muted">
                {d.status_code ? `HTTP ${d.status_code}` : d.error}
                {d.attempt && d.attempt > 1 ? ` · try ${d.attempt}` : ""}
              </span>
              <span className="w-20 shrink-0 text-right text-[12px] text-d-faint">{when(d.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
