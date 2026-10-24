"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle, Database, Lightning, Sparkle, XCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { BarChart } from "@/components/dashboard/charts";
import {
  Button,
  Card,
  CardHeader,
  Notice,
  PageHeader,
  Segmented,
  Skeleton,
  StatCard,
  StatGrid,
  Toggle,
} from "@/components/dashboard/primitives";
import { compact } from "@/components/operator/ui";
import {
  can,
  saveAssistantSettings,
  useAssistantAdmin,
  useOperatorSession,
  type AssistantAdmin,
  type AssistantSettings,
} from "@/lib/fable/operator";

type NumberKey = Exclude<keyof AssistantSettings, "ai_enabled">;

const GROUPS: { title: string; body: string; keys: { key: NumberKey; label: string; unit: string }[] }[] = [
  {
    title: "Per person",
    body: "Hard limits. Past them a person is told to wait, with the reason.",
    keys: [
      { key: "per_person_per_minute", label: "Questions a minute", unit: "a minute" },
      { key: "per_person_per_day", label: "Questions a day", unit: "a day" },
    ],
  },
  {
    title: "Per institution",
    body: "AI answers a bank gets each day. Past it, answers come from its own figures at no model cost.",
    keys: [{ key: "institution_daily_answers", label: "AI answers a day", unit: "a day" }],
  },
  {
    title: "Cost of each answer",
    body: "These bound how many tokens any single answer can use.",
    keys: [
      { key: "max_output_tokens", label: "Longest answer", unit: "tokens" },
      { key: "max_history_turns", label: "Earlier messages sent", unit: "messages" },
      { key: "max_question_chars", label: "Longest question", unit: "characters" },
    ],
  },
  {
    title: "Cache",
    body: "A repeated opening question about unchanged figures reuses its answer instead of paying again.",
    keys: [{ key: "cache_minutes", label: "Reuse answers for", unit: "minutes" }],
  },
];

/** Ask Fable across the platform: which models answer, the limits, and what it costs. */
export default function OperatorAssistantPage() {
  const session = useOperatorSession();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const { data, mutate } = useAssistantAdmin(Number(days));
  const owner = can(session?.role, "platform_owner");

  return (
    <>
      <PageHeader
        title="Ask Fable"
        description="The analyst assistant in every bank's console: usage and limits."
        actions={<Segmented<"7" | "30" | "90"> value={days} onChange={setDays}
          options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} />}
      />
      {!data ? <Skeleton className="h-96" /> : <Body data={data} owner={owner} onSaved={() => mutate()} />}
    </>
  );
}

function Body({ data, owner, onSaved }: { data: AssistantAdmin; owner: boolean; onSaved: () => void }) {
  const u = data.usage;
  const answered = u.totals.questions || 0;
  const cacheRate = answered ? Math.round((u.totals.cached_answers / answered) * 100) : 0;
  const anyProvider = data.providers.openai.configured || data.providers.anthropic.configured;

  return (
    <>
      <StatGrid>
        <StatCard label="Questions today" value={compact(u.today.questions)} sub={`${compact(u.totals.questions)} in ${u.days} days`} icon={<Sparkle size={17} weight="fill" />} featured />
        <StatCard label="AI answers today" value={compact(u.today.model_answers)} sub={`${compact(u.totals.model_answers)} in ${u.days} days`} icon={<Lightning size={17} weight="fill" />} tone="warning" />
        <StatCard label={`Tokens, ${u.days} days`} value={compact(u.totals.input_tokens + u.totals.output_tokens)}
          sub={`${compact(u.totals.input_tokens)} in, ${compact(u.totals.output_tokens)} out`} tone="danger" />
        <StatCard label="Answered from cache" value={`${cacheRate}%`} sub={`${compact(u.totals.cached_answers)} answers at no cost`} icon={<Database size={17} weight="fill" />} tone="success" />
      </StatGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <CardHeader title="Answers per day" subtitle="How each answer was produced" />
            <div className="flex flex-wrap gap-1.5">
              <Provider name="OpenAI" model={data.providers.openai.model} on={data.providers.openai.configured} />
              <Provider name="Anthropic" model={data.providers.anthropic.model} on={data.providers.anthropic.configured} />
            </div>
          </div>
          {!anyProvider && <Notice tone="warning" className="mb-3">No AI provider key is set, so every answer comes from the figures.</Notice>}
          <BarChart
            data={fillDays(u.by_day, u.days).map((d) => ({
              label: d.label,
              values: [d.model, d.cached, Math.max(d.questions - d.model - d.cached, 0)],
            }))}
            series={[
              { key: "model", label: "AI", color: "#7c3aed" },
              { key: "cached", label: "Cache", color: "#10b981" },
              { key: "figures", label: "Figures only", color: "#a1a1aa" },
            ]}
            height={230}
            empty="No questions in this period"
          />
        </Card>

        <Card padded={false} className="flex flex-col">
          <div className="px-5 pb-3 pt-5"><CardHeader title="By institution" subtitle={`Last ${u.days} days`} /></div>
          {u.by_institution.length === 0 ? (
            <p className="flex flex-1 items-center justify-center border-t border-d-border px-5 py-8 text-[13px] text-d-muted">No questions yet.</p>
          ) : (
            <ul className="flex-1 divide-y divide-d-border overflow-y-auto border-t border-d-border lg:max-h-[300px]">
              {u.by_institution.map((r) => (
                <li key={r.institution_id}>
                  <Link href={`/operator/institutions/${encodeURIComponent(r.institution_id)}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-d-surface-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-d-text">{r.name ?? r.institution_id}</span>
                      <span className="block text-[12px] text-d-muted">{compact(r.model_answers)} AI · {compact(r.input_tokens + r.output_tokens)} tokens</span>
                    </span>
                    <span className="shrink-0 text-right text-[13px] font-semibold tabular-nums text-d-text">{compact(r.questions)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <SettingsForm data={data} owner={owner} onSaved={onSaved} />

    </>
  );
}

function Provider({ name, model, on }: { name: string; model: string; on: boolean }) {
  return (
    <span title={on ? `${name}: ${model}` : `${name}: no key set`}
      className="inline-flex items-center gap-1.5 rounded-full border border-d-border px-2.5 py-1 text-[12px] text-d-muted">
      {on ? <CheckCircle size={13} weight="fill" className="text-emerald-500" /> : <XCircle size={13} weight="fill" className="text-d-faint" />}
      <span className="font-medium text-d-text">{name}</span>
      {on && <span className="font-mono text-[11px]">{model}</span>}
    </span>
  );
}

function SettingsForm({ data, owner, onSaved }: { data: AssistantAdmin; owner: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState<AssistantSettings>(data.settings);
  const [busy, setBusy] = useState(false);
  const changed = useMemo(
    () => (Object.keys(draft) as (keyof AssistantSettings)[]).filter((k) => draft[k] !== data.settings[k]),
    [draft, data.settings],
  );
  const invalid = (Object.keys(data.fields) as (keyof AssistantSettings)[]).filter((k) => {
    const f = data.fields[k];
    const v = draft[k];
    return typeof v === "number" && (!Number.isInteger(v) || v < (f.min as number) || v > (f.max as number));
  });

  async function save() {
    setBusy(true);
    try {
      const body = Object.fromEntries(changed.map((k) => [k, draft[k]])) as Partial<AssistantSettings>;
      const r = await saveAssistantSettings(body);
      setDraft(r.settings);
      toast.success("Ask Fable limits saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <CardHeader title="Limits" subtitle={owner ? "Apply to the next question. Recorded in the audit log." : "Only a platform owner can change these."} />
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-d-text">AI answers</span>
          <Toggle label="AI answers" on={draft.ai_enabled} onChange={() => owner && setDraft((d) => ({ ...d, ai_enabled: !d.ai_enabled }))} />
        </div>
      </div>
      {!draft.ai_enabled && <Notice tone="warning" className="mb-4">AI answers are off for every institution. Ask Fable answers from each bank&apos;s figures, at no cost.</Notice>}

      <ul className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
        {GROUPS.flatMap((g) => g.keys).map(({ key, label, unit }) => {
          const f = data.fields[key];
          const bad = invalid.includes(key);
          return (
            <li key={key} className="flex items-center justify-between gap-4 border-b border-d-border py-2.5">
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-d-text" title={f.help}>{label}</span>
                <span className={`block text-[11px] ${bad ? "text-red-500" : "text-d-faint"}`}>
                  {bad ? `Between ${f.min} and ${f.max}` : `Default ${String(f.default)}`}
                </span>
              </span>
              <span className={`flex h-9 w-36 shrink-0 items-center rounded-lg border bg-d-surface-2 pr-2.5 ${bad ? "border-red-500" : "border-d-border focus-within:border-brand/50"}`}>
                <input type="number" inputMode="numeric" disabled={!owner} min={f.min as number} max={f.max as number} aria-label={label}
                  value={Number.isNaN(draft[key]) ? "" : draft[key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value === "" ? Number.NaN : Number(e.target.value) }))}
                  className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-[13px] tabular-nums text-d-text outline-none disabled:cursor-not-allowed" />
                <span className="shrink-0 text-[11px] text-d-faint">{unit}</span>
              </span>
            </li>
          );
        })}
      </ul>

      {owner && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {changed.length > 0 && <span className="mr-auto text-[12px] text-d-muted">{changed.length} unsaved change{changed.length === 1 ? "" : "s"}</span>}
          <Button variant="secondary" disabled={!changed.length || busy} onClick={() => setDraft(data.settings)}>Discard</Button>
          <Button loading={busy} disabled={!changed.length || invalid.length > 0} onClick={save}>Save limits</Button>
        </div>
      )}
    </Card>
  );
}

/** One bar per day for the period, with quiet days filled in. */
function fillDays(rows: { day: string; questions: number; model_answers: number; cached_answers: number }[], days: number) {
  const by = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  const now = Date.now() + 3_600_000; // Lagos time, which the usage is recorded in
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const r = by.get(key);
    out.push({
      label: d.toLocaleDateString("en-NG", { day: "numeric", month: "short", timeZone: "UTC" }),
      questions: r?.questions ?? 0,
      model: r?.model_answers ?? 0,
      cached: r?.cached_answers ?? 0,
    });
  }
  return out;
}
