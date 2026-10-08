"use client";

import { BrandingSettings } from "@/components/dashboard/BrandingSettings";
import { OwnerOnlyNotice } from "@/components/dashboard/settings/OwnerOnly";
import { useFableStore } from "@/lib/fable/store";

export default function BrandingSettingsPage() {
  const store = useFableStore();
  return (
    <>
      <OwnerOnlyNotice />
      <BrandingSettings institutionId={store?.session.institutionId ?? null} />
    </>
  );
}
