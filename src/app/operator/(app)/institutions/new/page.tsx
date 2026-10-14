"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CheckCircle, Copy } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button, ButtonLink, Card, CardHeader, Field, Notice, PageHeader, TextInput } from "@/components/dashboard/primitives";
import { provisionInstitution, type Invite, type InstitutionRow } from "@/lib/fable/operator";

const TYPES = ["Microfinance Bank", "Commercial Bank", "Payment Service Bank", "Fintech", "Mobile Money Operator", "Payment Service Provider"];

/**
 * Provision an institution. It is created empty, in sandbox mode, and its
 * first owner is invited by email to set a password. Nothing else is created:
 * the owner adds their customers, keys, policy and team in their own console.
 */
export default function NewInstitutionPage() {
  const [name, setName] = useState("");
  const [type, setType] = useState(TYPES[0]);
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [made, setMade] = useState<{ institution: InstitutionRow; owner_invite: Invite } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setMade(await provisionInstitution({ name: name.trim(), type, owner_email: ownerEmail.trim(), owner_name: ownerName.trim() || undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the institution.");
    } finally {
      setBusy(false);
    }
  }

  if (made) {
    const link = made.owner_invite.invite_link;
    return (
      <>
        <PageHeader title={made.institution.name} description="Created in sandbox mode, with no data." />
        <Card className="max-w-[640px]">
          <div className="flex items-start gap-3">
            <CheckCircle size={28} weight="fill" className="shrink-0 text-emerald-500" />
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-d-text">Institution created</p>
              <p className="mt-1 text-[13px] leading-relaxed text-d-muted">
                {made.owner_invite.emailed
                  ? `We emailed ${made.owner_invite.email} a link to set their password. It expires in 7 days.`
                  : `Email isn't set up on this server, so send ${made.owner_invite.email} this link yourself. It expires in 7 days and works once.`}
              </p>
            </div>
          </div>
          {link && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-d-border bg-d-surface-2 p-2 pl-3">
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-d-text">{link}</code>
              <Button variant="secondary" size="sm" icon={<Copy size={14} />}
                onClick={() => navigator.clipboard.writeText(link).then(() => toast.success("Invite link copied"))}>
                Copy
              </Button>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <ButtonLink href={`/operator/institutions/${encodeURIComponent(made.institution.institution_id)}`}>Open institution</ButtonLink>
            <Button variant="secondary" onClick={() => { setMade(null); setName(""); setOwnerEmail(""); setOwnerName(""); }}>
              Create another
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <Link href="/operator" className="inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-d-muted hover:text-d-text">
        <ArrowLeft size={14} /> Institutions
      </Link>
      <PageHeader title="New institution" description="It starts empty and in sandbox mode. The owner sets up everything else." />
      <Card className="max-w-[640px]">
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <CardHeader title="Institution" />
          <Field label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Clearwater Microfinance Bank" required />
          </Field>
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value)}
              className="h-11 w-full rounded-xl border border-d-border bg-d-surface-2 px-3 text-[14px] text-d-text outline-none focus:border-brand">
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <CardHeader title="First owner" subtitle="Gets a one-time link to set their password. No password or key is ever emailed." />
          <Field label="Owner's name">
            <TextInput value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Owner's work email">
            <TextInput type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="risk@clearwater.ng" required />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>Create institution</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
