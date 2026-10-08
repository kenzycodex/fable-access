"use client";

import { useEffect, useRef, useState } from "react";
import { LockSimple, Trash, UploadSimple } from "@phosphor-icons/react";
import { Badge, Button, Card, CardHeader, Field, Notice, TextInput } from "@/components/dashboard/primitives";
import {
  getBranding,
  removeLogo,
  updateBranding,
  uploadLogo,
  type Branding,
} from "@/lib/fable/api";

/**
 * How a bank makes the demo app look like its own product.
 *
 * The URL is the one field with a cooling period: it's a public link already
 * in a welcome email and possibly shared onward, so renaming it breaks live
 * URLs. The lock length is server configuration, not a constant here.
 */
export function BrandingSettings({ institutionId }: { institutionId: string | null }) {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [form, setForm] = useState({
    display_name: "",
    slug: "",
    primary_color: "#7C3AED",
    accent_color: "#0B0D12",
    tagline: "",
    support_email: "",
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "danger"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!institutionId) return;
    let cancelled = false;
    getBranding(institutionId)
      .then((b) => {
        if (cancelled) return;
        setBranding(b);
        setForm({
          display_name: b.display_name ?? "",
          slug: b.slug ?? "",
          primary_color: b.primary_color,
          accent_color: b.accent_color,
          tagline: b.tagline ?? "",
          support_email: b.support_email ?? "",
        });
      })
      .catch(() => !cancelled && setMessage({ kind: "danger", text: "Could not load branding. Is the API running?" }));
    return () => {
      cancelled = true;
    };
  }, [institutionId]);

  async function save() {
    if (!institutionId || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      // Only send the URL when it actually changed, so an unchanged form never
      // trips the cooling period.
      const patch: Partial<Branding> = { ...form };
      if (branding && form.slug === branding.slug) delete patch.slug;

      const next = await updateBranding(institutionId, patch);
      setBranding(next);
      setMessage({ kind: "success", text: "Branding saved. Your demo bank reflects it immediately." });
    } catch (err) {
      setMessage({ kind: "danger", text: err instanceof Error ? err.message : "Could not save branding." });
    } finally {
      setSaving(false);
    }
  }

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !institutionId) return;
    setUploading(true);
    setMessage(null);
    try {
      setBranding(await uploadLogo(institutionId, file));
      setMessage({ kind: "success", text: "Logo updated." });
    } catch (err) {
      setMessage({ kind: "danger", text: err instanceof Error ? err.message : "Upload failed." });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function clearLogo() {
    if (!institutionId) return;
    try {
      setBranding(await removeLogo(institutionId));
    } catch {
      setMessage({ kind: "danger", text: "Could not remove the logo." });
    }
  }

  const slugLocked = branding?.slug_locked ?? false;
  const previewName = form.display_name || "Your bank";

  return (
    <Card>
      <CardHeader title="Branding" subtitle="Your customers see your bank, not Fable. Changes apply to your demo bank instantly." />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-5 lg:col-span-3">
          <div>
            <p className="mb-2 text-[12px] font-semibold text-d-muted">Logo</p>
            <div className="flex items-center gap-3">
              <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-d-surface-2">
                {branding?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- data URI
                  <img src={branding.logo_url} alt="Logo" className="size-full object-contain" />
                ) : (
                  <span className="text-[11px] text-d-faint">None</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileRef.current?.click()} icon={<UploadSimple size={14} weight="bold" />}>
                  Upload
                </Button>
                {branding?.logo_url && (
                  <Button variant="ghost" size="sm" onClick={clearLogo} icon={<Trash size={14} weight="bold" />} className="!text-red-500">
                    Remove
                  </Button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onLogo} className="hidden" />
            </div>
            <p className="mt-1.5 text-[12px] text-d-faint">PNG, JPEG or WebP.</p>
          </div>

          <Field label="Display name">
            <TextInput
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              placeholder="Meridian MFB"
            />
          </Field>

          <Field
            label="Demo bank URL"
            right={
              slugLocked ? (
                <Badge tone="warning">
                  <LockSimple size={11} weight="fill" /> Locked
                </Badge>
              ) : undefined
            }
            hint={
              slugLocked && branding?.slug_locked_until
                ? `Changed recently, unlocks ${branding.slug_locked_until.slice(0, 10)}. This protects links already shared with your customers.`
                : `Changing this breaks links already shared. It locks for ${branding?.slug_lock_days ?? 7} days afterwards.`
            }
          >
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[13px] text-d-faint">/demo/</span>
              <TextInput
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
                disabled={slugLocked}
                placeholder="zenith-bank"
              />
            </div>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Primary colour">
              <ColorInput value={form.primary_color} onChange={(v) => setForm({ ...form, primary_color: v })} />
            </Field>
            <Field label="Accent colour">
              <ColorInput value={form.accent_color} onChange={(v) => setForm({ ...form, accent_color: v })} />
            </Field>
          </div>

          <Field label="Tagline">
            <TextInput value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="Banking that protects you" />
          </Field>

          <Field label="Support email">
            <TextInput value={form.support_email} onChange={(e) => setForm({ ...form, support_email: e.target.value })} placeholder="support@yourbank.ng" />
          </Field>

          {message && <Notice tone={message.kind}>{message.text}</Notice>}

          <div>
            <Button onClick={save} loading={saving} disabled={!institutionId}>
              Save branding
            </Button>
          </div>
        </div>

        {/* A live swatch of what the two colours do, so the choice is not blind. */}
        <div className="lg:sticky lg:top-24 lg:col-span-2">
          <p className="mb-2 text-[12px] font-semibold text-d-muted">Preview</p>
          <div className="overflow-hidden rounded-2xl border border-d-border">
            <div className="px-5 pb-6 pt-5 text-white" style={{ backgroundColor: form.accent_color }}>
              <div className="flex items-center gap-3">
                <span
                  className="flex size-9 items-center justify-center overflow-hidden rounded-xl text-[14px] font-bold text-white"
                  style={{ backgroundColor: form.primary_color }}
                >
                  {branding?.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data URI
                    <img src={branding.logo_url} alt="" className="size-full object-contain" />
                  ) : (
                    previewName.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="text-[15px] font-semibold">{previewName}</span>
              </div>
              <p className="mt-5 text-[12px] opacity-70">Available balance</p>
              <p className="text-[24px] font-bold tabular-nums">₦248,500.00</p>
            </div>
            <div className="bg-d-surface p-5">
              <p className="mb-3 text-[12px] text-d-muted">{form.tagline || "Your tagline appears here"}</p>
              <span
                className="inline-flex h-10 items-center rounded-xl px-5 text-[13px] font-semibold text-white"
                style={{ backgroundColor: form.primary_color }}
              >
                Send money
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        aria-label="Pick a colour"
        className="size-12 shrink-0 cursor-pointer rounded-xl border border-d-border bg-transparent p-1"
      />
      <TextInput value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="font-mono" aria-label="Hex colour" />
    </div>
  );
}
