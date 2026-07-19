"use client";

import { useEffect, useRef, useState } from "react";
import { LockSimple, Trash, UploadSimple } from "@phosphor-icons/react";
import { Card } from "@/components/dashboard/primitives";
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
    accent_color: "#00D4FF",
    tagline: "",
    support_email: "",
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
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
      .catch(() => !cancelled && setMessage({ kind: "error", text: "Couldn't load branding — is the API running?" }));
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
      setMessage({ kind: "ok", text: "Branding saved. Your demo bank will reflect it immediately." });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not save branding.",
      });
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
      setMessage({ kind: "ok", text: "Logo updated." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Upload failed." });
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
      setMessage({ kind: "error", text: "Could not remove the logo." });
    }
  }

  const slugLocked = branding?.slug_locked ?? false;

  return (
    <Card>
      <h2 className="mb-1 text-[16px] font-bold text-gray-900 dark:text-white">Branding</h2>
      <p className="mb-5 text-[12px] text-gray-500 dark:text-white/40">
        Your customers see your bank, not Fable. This applies to your demo bank instantly.
      </p>

      <div className="flex flex-col gap-5">
        {/* Logo */}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/40">Logo</p>
          <div className="flex items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-white/[0.06] dark:bg-white/[0.03]">
              {branding?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URI
                <img src={branding.logo_url} alt="Logo" className="size-full object-contain" />
              ) : (
                <span className="text-[10px] text-gray-400 dark:text-white/25">None</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-white/[0.08] dark:text-white/70 dark:hover:bg-white/[0.04]"
              >
                <UploadSimple size={14} weight="bold" />
                {uploading ? "Uploading…" : "Upload"}
              </button>
              {branding?.logo_url && (
                <button
                  type="button"
                  onClick={clearLogo}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-semibold text-red-600 transition-colors hover:bg-red-50 dark:border-white/[0.08] dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  <Trash size={14} weight="bold" />
                  Remove
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onLogo}
              className="hidden"
            />
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400 dark:text-white/25">PNG, JPEG or WebP.</p>
        </div>

        <Field label="Display name">
          <input
            value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            placeholder="Meridian MFB"
            className={inputClass}
          />
        </Field>

        {/* URL — the field with the cooling period */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/40">
              Demo bank URL
            </p>
            {slugLocked && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                <LockSimple size={11} weight="fill" />
                Locked
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[12px] text-gray-400 dark:text-white/30">/demo/</span>
            <input
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
              disabled={slugLocked}
              placeholder="zenith-bank"
              className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-50`}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400 dark:text-white/25">
            {slugLocked && branding?.slug_locked_until
              ? `Changed recently — unlocks ${branding.slug_locked_until.slice(0, 10)}. This protects links already shared with your customers.`
              : `Changing this breaks links already shared. It locks for ${branding?.slug_lock_days ?? 7} days afterwards.`}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Primary colour">
            <ColorInput
              value={form.primary_color}
              onChange={(v) => setForm({ ...form, primary_color: v })}
            />
          </Field>
          <Field label="Accent colour">
            <ColorInput
              value={form.accent_color}
              onChange={(v) => setForm({ ...form, accent_color: v })}
            />
          </Field>
        </div>

        <Field label="Tagline">
          <input
            value={form.tagline}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
            placeholder="Banking that protects you"
            className={inputClass}
          />
        </Field>

        <Field label="Support email">
          <input
            value={form.support_email}
            onChange={(e) => setForm({ ...form, support_email: e.target.value })}
            placeholder="support@yourbank.ng"
            className={inputClass}
          />
        </Field>

        {message && (
          <p
            className={`rounded-lg px-3 py-2 text-[12px] ${
              message.kind === "ok"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                : "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
            }`}
          >
            {message.text}
          </p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving || !institutionId}
          className="rounded-xl bg-[#7C3AED] py-3 text-[13px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save branding"}
        </button>
      </div>
    </Card>
  );
}

const inputClass =
  "w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-900 outline-none focus:ring-1 focus:ring-[#7C3AED]/40 dark:border-white/[0.06] dark:bg-[#111] dark:text-white";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-white/40">
        {label}
      </p>
      {children}
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="size-10 shrink-0 cursor-pointer rounded-lg border border-gray-200 bg-transparent dark:border-white/[0.08]"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className={`${inputClass} font-mono`}
      />
    </div>
  );
}
