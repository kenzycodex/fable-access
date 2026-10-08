"use client";

import { useState } from "react";
import useSWR from "swr";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { BankCard } from "@/components/demo/BankCard";
import { useInstitution } from "@/components/demo/InstitutionProvider";
import { PageHeader } from "@/components/demo/PageHeader";
import { Badge, Button, Card, CardHeader, DetailRow, Notice, Screen, Skeleton } from "@/components/demo/kit";
import { summarizeCustomer } from "@/lib/fable/analytics";
import { customerOverview } from "@/lib/fable/api";
import { accountNumberFor, cardFor, formatNaira, groupDigits } from "@/lib/fable/format";

export default function CardsPage() {
  const { customer, institutionId, name: bankName } = useInstitution();
  const [reveal, setReveal] = useState(false);

  const { data: overview } = useSWR(
    customer ? ["demo:overview", customer.user_id, institutionId] : null,
    () => customerOverview(customer!.user_id, institutionId),
    { refreshInterval: 15_000, keepPreviousData: true },
  );

  const card = customer ? cardFor(customer.user_id) : null;
  const spent = overview ? summarizeCustomer(overview.transactions, 0).spent : null;

  return (
    <Screen>
      <PageHeader title="My cards" subtitle="Your debit card and linked account" back />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-6">
          {card && customer ? (
            <BankCard holder={customer.name} number={card.number} expiry={card.expiry} reveal={reveal} className="max-w-[480px]" />
          ) : (
            <Skeleton className="aspect-[1.586/1] w-full max-w-[480px] rounded-[22px]" />
          )}
          <Button
            variant="secondary"
            size="lg"
            className="w-full max-w-[480px]"
            icon={reveal ? <EyeSlash size={18} /> : <Eye size={18} />}
            onClick={() => setReveal((r) => !r)}
          >
            {reveal ? "Hide card details" : "Show card details"}
          </Button>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-6">
          <Card>
            <CardHeader title="Card details" action={<Badge tone="success">Active</Badge>} />
            <div className="divide-y divide-d-border">
              <DetailRow label="Card holder">{customer?.name ?? "—"}</DetailRow>
              <DetailRow label="Card number">
                <span className="font-mono tabular-nums">
                  {card ? (reveal ? groupDigits(card.number) : `•••• •••• •••• ${card.last4}`) : "—"}
                </span>
              </DetailRow>
              <DetailRow label="Valid thru">{card?.expiry ?? "—"}</DetailRow>
              <DetailRow label="Linked account">
                <span className="font-mono tabular-nums">{customer ? accountNumberFor(customer.user_id) : "—"}</span>
              </DetailRow>
              <DetailRow label="Spent this month">{spent === null ? "—" : formatNaira(spent)}</DetailRow>
            </div>
          </Card>

          <Notice>
            This is a demo card issued by {bankName}. It has no card network behind it, so it can&apos;t be used to
            pay anywhere. Transfers from the account are checked by Fable like any other.
          </Notice>
        </div>
      </div>
    </Screen>
  );
}
