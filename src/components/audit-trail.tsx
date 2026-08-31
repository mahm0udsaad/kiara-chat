"use client";

/**
 * The owner's responsibility trail, on the web.
 *
 * Same two reports the phone shows, from the same endpoints: who held a
 * conversation and what they did while they held it, and every action taken on
 * one order. Both load on demand — they are the answer to a question the owner
 * asks occasionally, not something worth fetching beside every sheet that
 * opens.
 *
 * Rendered only for admins; the endpoints refuse everyone else, and the
 * callers hide the entrance rather than showing a control that 403s.
 */
import {
  BellRing,
  Car,
  CircleCheck,
  ClipboardList,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Tags,
  UserRound,
} from "lucide-react";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type {
  AuditEntry,
  AuditPerson,
  ConversationAuditReport,
  CustodyPeriod,
  OrderAuditLog,
} from "@/lib/audit-report";

const DATE_TIME_FMT = new Intl.DateTimeFormat("ar-SA", {
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
});

const ROLE_LABEL: Record<string, string> = {
  admin: "مديرة",
  agent: "موظفة",
  owner: "المالكة",
  specialist: "أخصائية",
  driver: "سائق",
  system: "النظام",
};

const START_LABEL: Record<CustodyPeriod["startedBy"], string> = {
  start: "قبل الاستلام",
  claim: "استلمتها بنفسها",
  reassign: "حُوّلت إليها",
  takeover: "سحبتها",
  release: "أُطلقت للطابور",
  bot: "عادت للبوت",
};

function EntryIcon({ type }: { type: string }) {
  const className = "size-4 shrink-0 text-muted-foreground";
  if (type === "order.created") return <Plus className={className} aria-hidden="true" />;
  if (type === "order.updated") return <Pencil className={className} aria-hidden="true" />;
  if (type.startsWith("order.dispatch"))
    return <Send className={className} aria-hidden="true" />;
  if (type === "field.reminder_sent")
    return <BellRing className={className} aria-hidden="true" />;
  if (type.startsWith("field.")) return <Car className={className} aria-hidden="true" />;
  if (type.startsWith("custody."))
    return <UserRound className={className} aria-hidden="true" />;
  if (type.includes("label")) return <Tags className={className} aria-hidden="true" />;
  if (type.includes("note"))
    return <MessageSquare className={className} aria-hidden="true" />;
  return <CircleCheck className={className} aria-hidden="true" />;
}

function personLabel(person: AuditPerson | null): string {
  if (!person) return "النظام";
  const role = ROLE_LABEL[person.role];
  return role ? `${person.name} · ${role}` : person.name;
}

function EntryRow({
  entry,
  /** Suppresses the actor line while it only repeats the period's holder. */
  holder,
  showActor = false,
}: {
  entry: AuditEntry;
  holder?: AuditPerson | null;
  showActor?: boolean;
}) {
  const foreign =
    entry.actor && holder && entry.actor.key !== holder.key ? entry.actor : null;
  return (
    <li className="flex items-start gap-2 py-1.5">
      <span className="mt-0.5">
        <EntryIcon type={entry.type} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {entry.title}
          {foreign ? <span className="text-muted-foreground"> · {foreign.name}</span> : null}
        </p>
        {showActor ? (
          <p className="text-xs text-muted-foreground">{personLabel(entry.actor)}</p>
        ) : null}
        {entry.detail ? (
          <p className="text-xs text-muted-foreground">{entry.detail}</p>
        ) : null}
      </div>
      <time className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {DATE_TIME_FMT.format(new Date(entry.at))}
      </time>
    </li>
  );
}

/** Loads on demand — the opening click asks for it — and keeps what it got. */
function useAuditFetch<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(url);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? "تعذّر التحميل");
      setData(body as T);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر التحميل");
    } finally {
      setLoading(false);
    }
  }, [url]);

  return { data, loading, error, load };
}

function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-dashed p-3">
      <p className="text-sm text-rose-700">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        إعادة المحاولة
      </Button>
    </div>
  );
}

/** Every action taken on one order, oldest first. */
export function OrderAuditPanel({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const { data, loading, error, load } = useAuditFetch<OrderAuditLog>(
    `/api/orders/${orderId}/audit`,
  );

  if (!open) {
    return (
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <ClipboardList data-icon="inline-start" />
        سجل الإجراءات
      </Button>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">سجل الإجراءات</h3>
      {loading ? (
        <div className="flex h-16 items-center justify-center">
          <Spinner />
        </div>
      ) : error ? (
        <Failed message={error} onRetry={load} />
      ) : data ? (
        <>
          <p className="text-xs text-muted-foreground">
            أنشأت الطلب: {data.createdBy ? personLabel(data.createdBy) : "غير معروف"}
          </p>
          {data.entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">لا توجد إجراءات مسجلة.</p>
          ) : (
            <ul className="divide-y rounded-md border px-3">
              {data.entries.map((entry, index) => (
                <EntryRow key={`${entry.at}-${entry.type}-${index}`} entry={entry} showActor />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}

/** The custody trail for one conversation: periods, newest first. */
export function ConversationAuditPanel({
  conversationId,
}: {
  conversationId: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, loading, error, load } = useAuditFetch<ConversationAuditReport>(
    `/api/conversations/${conversationId}/audit`,
  );

  if (!open) {
    return (
      <Button
        variant="outline"
        className="w-full"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <ClipboardList data-icon="inline-start" />
        سجل المسؤولية والإجراءات
      </Button>
    );
  }

  if (loading) {
    return (
      <div className="flex h-20 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (error) return <Failed message={error} onRetry={load} />;
  if (!data) return null;

  // Newest first: the owner opens this to ask "who has it now", then reads
  // backwards.
  const periods = [...data.periods].reverse();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">سجل المسؤولية</h3>
        <Badge variant="outline">
          {data.currentHolder ? data.currentHolder.name : "غير مُسندة"}
        </Badge>
      </div>

      <dl className="grid grid-cols-4 gap-2 rounded-md border p-3 text-center">
        {[
          ["وارد", data.totals.inbound],
          ["ردود", data.totals.outbound],
          ["إجراءات", data.totals.actions],
          ["تسليمات", data.totals.handovers],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {data.messagesByPerson.length ? (
        <div className="rounded-md border px-3 py-2">
          <p className="pb-1 text-xs font-medium text-muted-foreground">ردود كل موظفة</p>
          <ul className="divide-y">
            {data.messagesByPerson.map((row) => (
              <li
                key={row.person.key}
                className="flex items-center justify-between py-1.5 text-sm"
              >
                <span>{row.person.name}</span>
                <span className="font-semibold tabular-nums">{row.messages}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {periods.length === 0 ? (
        <p className="text-xs text-muted-foreground">لم تُستلم هذه المحادثة بعد.</p>
      ) : null}

      {periods.map((period) => (
        <article
          key={`${period.from}-${period.holder?.key ?? "none"}`}
          className="flex flex-col gap-2 rounded-md border p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              {period.holder?.name ?? "بدون مسؤولة — البوت أو الطابور"}
            </p>
            {period.holder ? (
              <Badge variant="secondary">
                {ROLE_LABEL[period.holder.role] ?? period.holder.role}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {START_LABEL[period.startedBy]}
            {period.startedByActor ? ` بواسطة ${period.startedByActor.name}` : ""} ·{" "}
            {DATE_TIME_FMT.format(new Date(period.from))} —{" "}
            {period.to ? DATE_TIME_FMT.format(new Date(period.to)) : "حتى الآن"}
          </p>
          <div className="flex gap-1.5">
            <Badge variant="outline">وارد {period.inboundMessages}</Badge>
            <Badge variant="outline">ردود {period.outboundMessages}</Badge>
          </div>
          {period.actions.length ? (
            <>
              <Separator />
              <ul className="divide-y">
                {period.actions.map((entry, index) => (
                  <EntryRow
                    key={`${entry.at}-${entry.type}-${index}`}
                    entry={entry}
                    holder={period.holder}
                  />
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">لا إجراءات مسجلة في هذه الفترة.</p>
          )}
        </article>
      ))}
    </section>
  );
}
