"use client";

import { LockSimple } from "@phosphor-icons/react";
import { usePermissions } from "@/lib/fable/useConsole";

/** A note shown above a settings section the signed-in role can read but not change. */
export function OwnerOnlyNotice() {
  const { canManage, loaded } = usePermissions();
  if (!loaded || canManage) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-d-surface-2 px-4 py-3 text-[13px] text-d-muted">
      <LockSimple size={15} />
      Only an owner can change these settings. You can view them.
    </div>
  );
}
