"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { mutate as swrMutate } from "swr";
import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { Badge, Button, Card, CardHeader, Field, Notice, TextInput, inputClass } from "@/components/dashboard/primitives";
import { LAYOUTS, setConsoleLayout, useConsoleLayout, type ConsoleLayout } from "@/lib/fable/layout";
import { ALL_INSTITUTION_TYPES, INSTITUTION_TYPE_GROUPS, OTHER_TYPE } from "@/data/institution-types";
import { updateInstitutionProfile } from "@/lib/fable/api";
import { useFableStore } from "@/lib/fable/store";
import { usePermissions } from "@/lib/fable/useConsole";
import { useSignedInInstitution } from "@/lib/fable/useInstitution";

type ThemeChoice = "light" | "dark" | "system";

export default function GeneralSettingsPage() {
  const { institution } = useSignedInInstitution();
  const store = useFableStore();
  const institutionId = store?.session.institutionId ?? null;

  return (
    <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 [&>*]:h-full">
        <ProfileCard
          key={institution ? `${institution.name}|${institution.type}|${institution.contact_email}` : "loading"}
          institutionId={institutionId}
          profile={institution}
        />
      </div>
      <AppearanceCard />
      <div className="lg:col-span-3">
        <LayoutCard />
      </div>
    </div>
  );
}

/** A small drawing of each layout, in SVG so it keeps its own shape whatever
 * layout the console is in while you choose. */
function LayoutPreview({ id }: { id: ConsoleLayout }) {
  const r = id === "soft" ? 6 : id === "compact" ? 2 : 0;
  const rail = id === "compact" ? 14 : 38;
  const card = "var(--d-surface)";
  const stroke = id === "compact" ? "none" : "var(--d-border)";
  const shadow = id === "soft";
  return (
    <svg viewBox="0 0 200 112" className="h-auto w-full" aria-hidden>
      <defs>
        <filter id={`lift-${id}`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#4c1d95" floodOpacity="0.12" />
        </filter>
      </defs>
      <rect width="200" height="112" fill={id === "sharp" ? "#f4f4f5" : "var(--d-bg)"} />
      <rect width={rail} height="112" fill="var(--d-surface)" stroke="var(--d-border)" />
      {Array.from({ length: 5 }).map((_, i) => (
        <rect key={i} x={id === "compact" ? 4 : 6} y={12 + i * 14} width={id === "compact" ? 6 : rail - 12} height="6" rx={r / 2} fill={i === 0 ? "var(--brand-primary)" : "var(--d-border)"} />
      ))}
      {[0, 1, 2].map((i) => (
        <rect key={i} x={rail + 8 + i * ((200 - rail - 16) / 3)} y="10" width={(200 - rail - 16) / 3 - 6} height="26" rx={r}
          fill={i === 0 && id !== "sharp" ? "var(--brand-primary)" : card} stroke={stroke} filter={shadow ? `url(#lift-${id})` : undefined} />
      ))}
      <rect x={rail + 8} y="44" width={200 - rail - 16} height="58" rx={r} fill={card} stroke={stroke} filter={shadow ? `url(#lift-${id})` : undefined} />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={rail + 14} y={54 + i * (id === "compact" ? 11 : 14)} width={200 - rail - 28} height="4" rx="1" fill="var(--d-border)" />
      ))}
    </svg>
  );
}

function LayoutCard() {
  const layout = useConsoleLayout();
  return (
    <Card>
      <CardHeader title="Layout" subtitle="How the console looks for you, on this device. Every page follows it." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {LAYOUTS.map((l) => {
          const active = layout === l.id;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => setConsoleLayout(l.id)}
              aria-pressed={active}
              className={`flex flex-col gap-3 rounded-xl border p-3 text-left transition-colors ${
                active ? "border-brand bg-brand/[0.06] ring-1 ring-brand/30" : "border-d-border bg-d-surface-2 hover:border-brand/30"
              }`}
            >
              <span className="block overflow-hidden rounded-lg border border-d-border">
                <LayoutPreview id={l.id} />
              </span>
              <span>
                <span className="flex items-center justify-between text-[14px] font-semibold text-d-text">
                  {l.name}
                  {active && <Badge tone="brand">In use</Badge>}
                </span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-d-muted">{l.summary}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const options: { value: ThemeChoice; label: string; hint: string; icon: React.ReactNode }[] = [
    { value: "light", label: "Light", hint: "Bright surfaces, best by day", icon: <Sun size={18} /> },
    { value: "dark", label: "Dark", hint: "Easy on the eyes at night", icon: <Moon size={18} /> },
    { value: "system", label: "System", hint: "Follows your device setting", icon: <Desktop size={18} /> },
  ];

  // Stretches to the height of the profile card beside it, with the choices as
  // full tiles, so the row reads as one balanced block.
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Appearance" subtitle="Just for you, on this device." />
      <div className="grid flex-1 grid-cols-3 gap-2 lg:grid-cols-1">
        {options.map((o) => {
          const active = theme === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setTheme(o.value)}
              aria-pressed={active}
              className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border px-3 py-2.5 text-[13px] font-semibold transition-colors lg:flex-row lg:justify-start lg:gap-3 ${
                active ? "border-brand/40 bg-brand/10 text-brand" : "border-d-border bg-d-surface-2 text-d-muted hover:text-d-text"
              }`}
            >
              {o.icon}
              <span className="flex flex-col items-center lg:items-start">
                {o.label}
                <span className="hidden text-[12px] font-normal text-d-muted lg:block">{o.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** The institution's editable profile.
 *
 * Remounted (via `key`) whenever the saved profile changes, so the inputs reset
 * to what was stored instead of syncing state inside an effect.
 *
 * Name, type and contact address are safe to change: the tenant id every
 * customer and API key hangs off is not derived from them. The sign-in email and
 * the public demo URL are separate settings, and the environment is a property
 * of the deployment, so it is shown but not editable. */
function ProfileCard({
  institutionId,
  profile,
}: {
  institutionId: string | null;
  profile: { name: string; type: string; contact_email: string | null } | null;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const savedType = profile?.type ?? "";
  // A type that is not in the list is shown as "Other" with its own text box, so
  // an institution that fits none of the categories is never forced into one.
  const [typeChoice, setTypeChoice] = useState(
    ALL_INSTITUTION_TYPES.includes(savedType) || !savedType ? savedType : OTHER_TYPE,
  );
  const [customType, setCustomType] = useState(ALL_INSTITUTION_TYPES.includes(savedType) ? "" : savedType);
  const type = typeChoice === OTHER_TYPE ? customType : typeChoice;
  const [email, setEmail] = useState(profile?.contact_email ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const { canManage } = usePermissions();
  const locked = !profile || !canManage;

  const dirty =
    !!profile && (name.trim() !== profile.name || type.trim() !== profile.type || email.trim() !== (profile.contact_email ?? ""));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!institutionId || !profile) return;
    setBusy(true);
    setMsg(null);
    try {
      const next = await updateInstitutionProfile(institutionId, {
        name: name.trim(),
        type: type.trim(),
        contact_email: email.trim(),
      });
      await swrMutate(["institution:profile", institutionId], next, { revalidate: false });
      setMsg({ tone: "success", text: "Profile saved." });
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof Error ? err.message : "Could not save the profile." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={save}>
        <div className="mb-5 flex items-start justify-between gap-3">
          <CardHeader title="Institution profile" subtitle="How your institution appears across Fable." />
          {canManage && (
            <Button type="submit" disabled={!dirty} loading={busy}>
              Save changes
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Institution name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={locked} />
          </Field>
          <Field label="Type">
            <select value={typeChoice} onChange={(e) => setTypeChoice(e.target.value)} disabled={locked} className={inputClass}>
              {!typeChoice && (
                <option value="" disabled>
                  Choose a type
                </option>
              )}
              {INSTITUTION_TYPE_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value={OTHER_TYPE}>Other (type your own)</option>
            </select>
            {typeChoice === OTHER_TYPE && (
              <TextInput
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                maxLength={60}
                placeholder="Describe your institution"
                aria-label="Describe your institution"
                className="mt-1.5"
              />
            )}
          </Field>
          <Field label="Contact email">
            <TextInput value={email} onChange={(e) => setEmail(e.target.value)} type="email" disabled={locked} />
          </Field>
          <Field label="Environment">
            <div className="flex h-12 items-center">
              <Badge tone="warning">Demo / sandbox</Badge>
            </div>
          </Field>
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-d-muted">
          The contact email is where your institution can be reached. It is not your sign-in email, and changing it does not
          change how you log in. Your institution id and API key stay the same when you rename.
        </p>

        {msg && <Notice tone={msg.tone} className="mt-4">{msg.text}</Notice>}
      </form>
    </Card>
  );
}
