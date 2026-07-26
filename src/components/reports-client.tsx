"use client";

import { useMemo, useState } from "react";
import {
  MessageSquare,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Inbox,
  Send,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import { WhatsAppIcon } from "@/components/icons/whatsapp";
import type { TeamReport, AgentReport, LabelCount } from "@/lib/analytics";
import type { LabelColor } from "@/lib/types";

const LABEL_CLASSES: Record<LabelColor, string> = {
  slate: "bg-slate-100 text-slate-700 border-slate-300",
  red: "bg-red-100 text-red-700 border-red-300",
  amber: "bg-amber-100 text-amber-700 border-amber-300",
  emerald: "bg-emerald-100 text-emerald-700 border-emerald-300",
  blue: "bg-blue-100 text-blue-700 border-blue-300",
  indigo: "bg-indigo-100 text-indigo-700 border-indigo-300",
  fuchsia: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300",
  rose: "bg-rose-100 text-rose-700 border-rose-300",
};

function Stat({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "default" | "warn" | "good";
}) {
  return (
    <div className="rounded-xl border bg-[var(--surface)] p-3">
      <div className="flex items-center gap-1.5 text-[var(--muted)]">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "warn" && "text-amber-600",
          tone === "good" && "text-emerald-600",
          tone === "default" && "text-[var(--foreground)]"
        )}
      >
        {value.toLocaleString("ar")}
      </p>
    </div>
  );
}

function LabelChips({ labels }: { labels: LabelCount[] }) {
  if (!labels.length) {
    return <span className="text-xs text-[var(--subtle)]">لا توجد تصنيفات.</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((l) => (
        <span
          key={l.id}
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] tabular-nums",
            LABEL_CLASSES[l.color]
          )}
        >
          {l.name} · {l.count.toLocaleString("ar")}
        </span>
      ))}
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentReport }) {
  const [open, setOpen] = useState(false);
  const total = agent.totalHandled || 1;
  const pct = (n: number) => Math.round((n / total) * 100);

  return (
    <li className={cn("rounded-2xl border bg-[var(--surface)]", !agent.isActive && "opacity-60")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-right"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand)]">
          {agent.name.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {agent.name}{" "}
            <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-normal text-[var(--brand)]">
              {agent.role === "admin" ? "مدير" : "موظف"}
            </span>
            {!agent.isActive ? (
              <span className="mr-1 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-normal text-slate-600">
                موقوف
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-[var(--muted)]">
            {agent.totalHandled.toLocaleString("ar")} محادثة ·{" "}
            {agent.messagesSent.toLocaleString("ar")} رسالة
            {agent.lastReplyAt ? ` · آخر رد ${formatRelativeTime(agent.lastReplyAt)}` : ""}
          </p>
        </div>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={cn("shrink-0 text-[var(--muted)] transition-transform", open && "rotate-180")}
        />
      </button>

      {/* Load split — a quick read on who is carrying open work. */}
      {agent.totalHandled > 0 ? (
        <div className="px-4 pb-3">
          <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="bg-[var(--brand)]" style={{ width: `${pct(agent.running)}%` }} />
            <div className="bg-amber-400" style={{ width: `${pct(agent.waiting)}%` }} />
            <div className="bg-emerald-500" style={{ width: `${pct(agent.resolved)}%` }} />
          </div>
        </div>
      ) : null}

      {open ? (
        <div className="space-y-3 border-t p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              icon={<MessageSquare size={14} aria-hidden="true" />}
              label="جارية"
              value={agent.running}
            />
            <Stat
              icon={<Clock size={14} aria-hidden="true" />}
              label="بانتظار العميل"
              value={agent.waiting}
              tone="warn"
            />
            <Stat
              icon={<CheckCircle2 size={14} aria-hidden="true" />}
              label="منتهية"
              value={agent.resolved}
              tone="good"
            />
            <Stat
              icon={<AlertTriangle size={14} aria-hidden="true" />}
              label="شكاوى"
              value={agent.complaints}
              tone={agent.complaints > 0 ? "warn" : "default"}
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--muted)]">التصنيفات</p>
            <LabelChips labels={agent.labels} />
          </div>
          {agent.email ? (
            <p dir="ltr" className="text-xs text-[var(--subtle)]">
              {agent.email}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ReportsClient({ report }: { report: TeamReport }) {
  const { agents, totals, labelTotals } = report;
  const activeAgents = useMemo(() => agents.filter((a) => a.isActive), [agents]);

  return (
    <div className="dashboard-page max-w-4xl">
      <div className="dashboard-page-header">
        <div>
          <h1>تقارير الموظفين</h1>
          <p>توزيع المحادثات والأداء لكل موظف.</p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          icon={<MessageSquare size={14} aria-hidden="true" />}
          label="إجمالي المحادثات"
          value={totals.conversations}
        />
        <Stat
          icon={<MessageSquare size={14} aria-hidden="true" />}
          label="جارية"
          value={totals.running}
        />
        <Stat
          icon={<Clock size={14} aria-hidden="true" />}
          label="بانتظار العميل"
          value={totals.waiting}
          tone="warn"
        />
        <Stat
          icon={<CheckCircle2 size={14} aria-hidden="true" />}
          label="منتهية"
          value={totals.resolved}
          tone="good"
        />
        <Stat
          icon={<Inbox size={14} aria-hidden="true" />}
          label="غير مسندة"
          value={totals.unassigned}
          tone={totals.unassigned > 0 ? "warn" : "default"}
        />
        <Stat
          icon={<AlertTriangle size={14} aria-hidden="true" />}
          label="شكاوى"
          value={totals.complaints}
          tone={totals.complaints > 0 ? "warn" : "default"}
        />
      </div>

      <div className="mb-6 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border bg-[var(--surface)] p-3">
          <div className="flex items-center gap-1.5 text-[var(--muted)]">
            <Send size={14} aria-hidden="true" />
            <span className="text-xs">رسائل أُرسلت من التطبيق</span>
          </div>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {totals.messagesSent.toLocaleString("ar")}
          </p>
        </div>
        <div className="rounded-xl border bg-[var(--surface)] p-3">
          <div className="flex items-center gap-1.5 text-[var(--muted)]">
            <WhatsAppIcon size={14} className="text-emerald-600" />
            <span className="text-xs">محادثات عولجت من تطبيق واتساب</span>
          </div>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {totals.handledOnWhatsApp.toLocaleString("ar")}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--subtle)]">
            لا يمكن نسبتها لموظف — واتساب لا يوفّر هوية المُرسِل.
          </p>
        </div>
      </div>

      {labelTotals.length ? (
        <div className="mb-6 rounded-2xl border bg-[var(--surface)] p-4">
          <p className="mb-2 text-sm font-medium">التصنيفات — الإجمالي</p>
          <LabelChips labels={labelTotals} />
        </div>
      ) : null}

      <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">
        الموظفون ({activeAgents.length.toLocaleString("ar")} نشط)
      </h2>
      {agents.length === 0 ? (
        <p className="rounded-xl border bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
          لا يوجد موظفون بعد. أضيفيهم من صفحة «الموظفون».
        </p>
      ) : (
        <ul className="space-y-2">
          {agents.map((a) => (
            <AgentCard key={a.teamMemberId} agent={a} />
          ))}
        </ul>
      )}
    </div>
  );
}
