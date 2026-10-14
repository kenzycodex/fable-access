"use client";

import Link from "next/link";
import { Card, PageHeader, Skeleton, table } from "@/components/dashboard/primitives";
import { usePlatformAudit } from "@/lib/fable/operator";

const LABEL: Record<string, string> = {
  "operator.login": "Signed in",
  "operator.invited": "Invited an operator",
  "operator.changed": "Changed an operator",
  "institution.provisioned": "Created an institution",
  "institution.suspended": "Suspended an institution",
  "institution.reactivated": "Reactivated an institution",
  "institution.owner_invited": "Invited an owner",
  "institution.exported": "Exported an institution's data",
  "institution.data_cleared": "Cleared an institution's customer data",
  "institution.deleted": "Deleted an institution",
};

/** What Fable's operators have done, newest first. */
export default function OperatorAuditPage() {
  const { data, isLoading } = usePlatformAudit();
  return (
    <>
      <PageHeader title="Audit" description="Every operator action, newest first. Kept permanently." />
      <Card padded={false}>
        {isLoading ? (
          <div className="p-5"><Skeleton className="h-40" /></div>
        ) : (
          <div className={table.wrap}>
            <table className={table.base}>
              <thead>
                <tr className={table.head}>
                  <th className={table.th}>When (UTC)</th>
                  <th className={table.th}>Operator</th>
                  <th className={table.th}>Action</th>
                  <th className={table.th}>Institution</th>
                  <th className={table.th}>Details</th>
                </tr>
              </thead>
              <tbody>
                {(data?.events ?? []).map((e) => {
                  const p = e.payload as Record<string, string | undefined>;
                  const detail = p.reason ?? p.owner ?? p.operator_email ?? p.name ?? "";
                  return (
                    <tr key={e.id} className={table.row}>
                      <td className={`${table.td} whitespace-nowrap tabular-nums text-d-muted`}>{e.created_at}</td>
                      <td className={table.td}>{p.operator ?? "-"}</td>
                      <td className={table.td}>{LABEL[e.event_type] ?? e.event_type}</td>
                      <td className={table.td}>
                        {e.institution_id ? (
                          <Link href={`/operator/institutions/${encodeURIComponent(e.institution_id)}`} className="text-brand hover:underline">
                            {e.institution_id}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className={`${table.td} max-w-[280px] truncate text-d-muted`}>{detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
