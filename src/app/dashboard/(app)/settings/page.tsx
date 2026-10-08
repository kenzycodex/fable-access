"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { mutate as swrMutate } from "swr";
import { Check, Copy, Desktop, Moon, Sun } from "@phosphor-icons/react";
import { BrandingSettings } from "@/components/dashboard/BrandingSettings";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Field,
  Notice,
  PageHeader,
  TextInput,
  inputClass,
} from "@/components/dashboard/primitives";
import { ALL_INSTITUTION_TYPES, INSTITUTION_TYPE_GROUPS, OTHER_TYPE } from "@/data/institution-types";
import { API_BASE, institutionCredentials, updateInstitutionProfile, type InstitutionCredentials } from "@/lib/fable/api";
import { useFableStore } from "@/lib/fable/store";
import { useSignedInInstitution } from "@/lib/fable/useInstitution";

type ThemeChoice = "light" | "dark" | "system";

export default function SettingsPage() {
  const { institution } = useSignedInInstitution();
  const store = useFableStore();
  const institutionId = store?.session.institutionId ?? null;

  return (
    <>
      <PageHeader title="Settings" description="Your institution profile, appearance, branding, API access and sign-in security." />

      <ProfileCard
        key={institution ? `${institution.name}|${institution.type}|${institution.contact_email}` : "loading"}
        institutionId={institutionId}
        profile={institution}
      />

      <BrandingSettings institutionId={institutionId} />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <ApiAccessCard institutionId={institutionId} />
        <AppearanceCard />
      </div>

      <PasswordCard />
    </>
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
      <CardHeader title="Appearance" subtitle="System follows your device setting." />
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

/** The signed-in institution's real API key, never a placeholder. When the API
 * is down it says so instead of inventing one. */
function ApiAccessCard({ institutionId }: { institutionId: string | null }) {
  const [creds, setCreds] = useState<InstitutionCredentials | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!institutionId) return;
    let cancelled = false;
    institutionCredentials(institutionId)
      .then((c) => !cancelled && setCreds(c))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [institutionId]);

  function copyKey() {
    if (!creds?.api_key) return;
    navigator.clipboard?.writeText(creds.api_key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Card>
      <CardHeader title="API access" subtitle="Authenticate server-to-server calls with this key." />
      <p className="mb-1.5 text-[12px] font-semibold text-d-muted">Live secret key</p>
      <div className="flex items-center gap-2 rounded-xl bg-d-surface-2 py-2 pl-4 pr-2">
        <code className="flex-1 truncate text-[13px] text-d-text">
          {creds?.masked_key ?? (failed ? "Unavailable, the API is offline" : "Loading...")}
        </code>
        <Button
          variant="secondary"
          size="sm"
          onClick={copyKey}
          disabled={!creds?.api_key}
          icon={copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-d-muted">Keep it on your servers. Never ship it in a mobile app or a web page.</p>
      <div className="mt-4">
        <ButtonLink href="/docs" variant="secondary" size="sm">
          Read the API reference
        </ButtonLink>
      </div>
    </Card>
  );
}

function PasswordCard() {
  const [email, setEmail] = useState("");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirm) return setMsg({ tone: "danger", text: "The new passwords do not match." });
    if (newPw.length < 8) return setMsg({ tone: "danger", text: "Use at least 8 characters." });
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, old_password: oldPw, new_password: newPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not change the password.");
      setMsg({ tone: "success", text: "Password changed." });
      setOldPw("");
      setNewPw("");
      setConfirm("");
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof Error ? err.message : "Could not change the password." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Sign-in security" subtitle="Change the administrator password." />
      {msg && <Notice tone={msg.tone} className="mb-4">{msg.text}</Notice>}
      <form onSubmit={submit} className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Admin email">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          </Field>
        </div>
        <Field label="Current password">
          <TextInput type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required autoComplete="current-password" />
        </Field>
        <span className="hidden sm:block" />
        <Field label="New password">
          <TextInput type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password">
          <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={busy}>
            Update password
          </Button>
        </div>
      </form>
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
          <Button type="submit" disabled={!dirty} loading={busy}>
            Save changes
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Institution name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={!profile} />
          </Field>
          <Field label="Type">
            <select value={typeChoice} onChange={(e) => setTypeChoice(e.target.value)} disabled={!profile} className={inputClass}>
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
            <TextInput value={email} onChange={(e) => setEmail(e.target.value)} type="email" disabled={!profile} />
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
