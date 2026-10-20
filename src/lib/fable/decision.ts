import type { ScoreResult } from "@/lib/fable/types";

/** Why a passed transfer went through, in words that are true for this
 * decision. "Matched how you normally bank" is only honest when Shield had the
 * customer's own history to compare with; a new customer was judged against
 * the bank's customers as a whole, or against nothing at all. */
export function passMessage(source: ScoreResult["baselineSource"]): string {
  if (source === "personal") return "This matched how you normally bank, so it went through with no extra steps.";
  return "Nothing unusual was found for this transfer, so it went through with no extra steps.";
}
