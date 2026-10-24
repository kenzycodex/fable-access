"use client";

import { useState } from "react";
import useSWR, { mutate as revalidate } from "swr";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dashboard/Dialog";
import { Button, Card, CardHeader, Field, TextInput } from "@/components/dashboard/primitives";
import { customerRecord, resetCustomerHistory } from "@/lib/fable/console";
import { useOnboarding, usePermissions } from "@/lib/fable/useConsole";

/** Sandbox only: an owner clears a test customer's history, so Shield forgets
 * what testing taught it and a demo starts from a clean slate. Never shown for
 * a real customer or a live institution (the API refuses both as well). */
export function TestCustomerReset({ userId }: { userId: string }) {
  const { canManage } = usePermissions();
  const { data: onboarding } = useOnboarding();
  const sandbox = onboarding ? onboarding.mode !== "live" : false;
  const { data: record } = useSWR(canManage ? ["customer-record", userId] : null, () => customerRecord(userId));
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  if (!canManage || !sandbox || !record || record.kind !== "test") return null;

  async function reset() {
    setBusy(true);
    try {
      const done = await resetCustomerHistory(userId, typed.trim());
      const transfers = done.rows_removed.transactions ?? 0;
      toast.success(`History cleared: ${transfers} transfer${transfers === 1 ? "" : "s"} removed`);
      setOpen(false);
      setTyped("");
      // Every list on the page (transfers, Copilot's view) is now out of date.
      void revalidate(() => true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The reset failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Test customer" subtitle="Sandbox only" />
      <Button variant="secondary" icon={<ArrowCounterClockwise size={16} />} onClick={() => setOpen(true)}>
        Reset history
      </Button>
      <p className="mt-3 text-[12px] text-d-muted">
        Clears their transfers and everything Shield learned from them: usual amounts, recipients, devices and places.
        Their next transfer scores like a new customer&apos;s. Their balance, PIN and passkeys stay.
      </p>
      <ConfirmDialog
        open={open}
        onClose={() => { setOpen(false); setTyped(""); }}
        onConfirm={reset}
        title="Reset this test customer's history?"
        description="Their transfers, holds and learned behaviour are removed. This cannot be undone."
        confirmLabel="Reset history"
        tone="danger"
        busy={busy}
      >
        <Field label={`Type ${record.reference} to confirm`}>
          <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Customer reference" autoComplete="off" />
        </Field>
      </ConfirmDialog>
    </Card>
  );
}
