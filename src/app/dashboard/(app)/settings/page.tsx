"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { mutate as swrMutate } from "swr";
import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { Badge, Button, Card, CardHeader, Field, Notice, TextInput, inputClass } from "@/components/dashboard/primitives";
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
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <ProfileCard
          key={institution ? `${institution.name}|${institution.type}|${institution.contact_email}` : "loading"}
          institutionId={institutionId}
          profile={institution}
        />
      </div>
      <AppearanceCard />
    </div>
  );
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const options: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: "Light", icon: <Sun size={16} /> },
    { value: "dark", label: "Dark", icon: <Moon size={16} /> },
    { value: "system", label: "System", icon: <Desktop size={16} /> },
  ];

  return (
    <Card>
      <CardHeader title="Appearance" subtitle="Just for you, on this device. System follows your OS." />
      <div className="grid grid-cols-3 gap-2">
        {options.map((o) => {
          const active = theme === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setTheme(o.value)}
              aria-pressed={active}
              className={`flex h-12 items-center justify-center gap-2 rounded-xl border text-[13px] font-semibold transition-colors ${
                active ? "border-brand/40 bg-brand/10 text-brand" : "border-d-border bg-d-surface-2 text-d-muted hover:text-d-text"
              }`}
            >
              {o.icon}
              {o.label}
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
