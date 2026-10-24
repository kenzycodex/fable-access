"use client";

import { useState } from "react";
import { Badge, Button } from "@/components/dashboard/primitives";
import { resetCustomerPin, type CopilotCustomer } from "@/lib/fable/api";
import { formatNaira } from "@/lib/fable/format";
import { usePermissions } from "@/lib/fable/useConsole";

/** Verification status for one customer, and the institution's PIN reset.
 *
 * Resetting clears the PIN rather than choosing one, so the bank never learns or
 * picks a customer's PIN: the customer sets a new one at their next
 * verification. It is a two-step control because it changes a security factor,
 * and only offered to roles the server will let do it. */
export function CustomerSecurity({
  customer,
  institutionId,
  onChanged,
  showBalance = true,
}: {
  customer: CopilotCustomer;
  institutionId: string | null;
  onChanged: () => void;
  showBalance?: boolean;
}) {
  const v = customer.verification;
  const { canReview } = usePermissions();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!v) return null;

  async function reset() {
    if (!institutionId) return;
    setBusy(true);
    setError(null);
    try {
      await resetCustomerPin(institutionId, customer.user_id);
      setConfirming(false);
      onChanged();
    } catch {
      setError("Could not reset the PIN. Sign in again and retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={v.pin_set && !v.pin_locked ? "success" : v.pin_locked ? "danger" : "neutral"}>
        {!v.pin_set ? "No PIN" : v.pin_locked ? "PIN locked" : "PIN set"}
      </Badge>
      <Badge tone={v.passkeys > 0 ? "success" : "neutral"}>
        {v.passkeys > 0 ? `${v.passkeys} device${v.passkeys === 1 ? "" : "s"}` : "No passkey"}
      </Badge>
      <Badge tone={v.contact_set ? "success" : "neutral"}>{v.contact_set ? "Codes reach them" : "No code contact"}</Badge>
      {showBalance && customer.balance != null && (
        <span className="text-[12px] font-semibold tabular-nums text-d-muted">Balance {formatNaira(customer.balance)}</span>
      )}

      {v.pin_set && canReview && (
        <span className="ml-auto flex items-center gap-2">
          {confirming ? (
            <>
              <span className="text-[12px] text-d-muted">Clear this customer&apos;s PIN?</span>
              <Button variant="danger" size="sm" loading={busy} onClick={reset}>
                Yes, reset
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
              Reset PIN
            </Button>
          )}
        </span>
      )}
      {error && <p className="w-full text-[12px] text-red-500">{error}</p>}
    </div>
  );
}
