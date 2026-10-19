"use client";

import { useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { DownloadSimple, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/dashboard/Dialog";
import { Button, Card, CardHeader, Field, Notice, TextInput } from "@/components/dashboard/primitives";
import { customerRecord, eraseCustomer, exportCustomer } from "@/lib/fable/console";
import { usePermissions } from "@/lib/fable/useConsole";

/** An owner answers a customer's request for their data, or to erase it. */
export function CustomerDataRights({ userId }: { userId: string }) {
  const { canManage } = usePermissions();
  const router = useRouter();
  const { data: record } = useSWR(canManage ? ["customer-record", userId] : null, () => customerRecord(userId));
  const [exporting, setExporting] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  if (!canManage || !record) return null;

  async function download() {
    setExporting(true);
    try {
      const data = await exportCustomer(userId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fable-customer-${record!.reference}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function erase() {
    setErasing(true);
    try {
      await eraseCustomer(userId, typed.trim());
      toast.success("Customer erased");
      router.push("/dashboard/customers");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The erasure failed.");
      setErasing(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Their data" subtitle="For a customer's request to see or erase what Fable holds" />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<DownloadSimple size={16} />} loading={exporting} onClick={download}>
          Download a copy
        </Button>
        <Button variant="danger" icon={<Trash size={16} />} onClick={() => setOpen(true)}>
          Erase this customer
        </Button>
      </div>
      <p className="mt-3 text-[12px] text-d-muted">
        Erasing removes everything that identifies them. Their past decisions stay only as anonymous outcomes for your
        reporting. It cannot be undone, and waits until any hold in progress has ended.
      </p>
      <ConfirmDialog
        open={open}
        onClose={() => { setOpen(false); setTyped(""); }}
        onConfirm={erase}
        title="Erase this customer?"
        description="This cannot be undone."
        confirmLabel="Erase"
        tone="danger"
        busy={erasing}
      >
        <Notice tone="warning" className="mb-4 text-[12px] leading-relaxed">
          <p className="font-semibold">Your bank decides whether this erasure is allowed.</p>
          <p className="mt-1">
            As the data controller, your institution must check it may erase this customer, including its record-keeping
            duties: Nigeria&apos;s money laundering rules require transaction records to be kept for at least 5 years.
            Fable keeps this customer&apos;s past decisions only as anonymous outcomes, with nothing that identifies them,
            so keep your own transaction records in your core banking system.
          </p>
        </Notice>
        <Field label={`Type ${record.reference} to confirm`}>
          <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Customer reference" autoComplete="off" />
        </Field>
      </ConfirmDialog>
    </Card>
  );
}
