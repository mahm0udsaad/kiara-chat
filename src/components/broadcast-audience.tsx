"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Users, X } from "lucide-react";
import { BOOKING_STAGE_LABEL, BOOKING_STAGE_ORDER } from "@/lib/booking-stage";
import { CONTACT_OUTCOME_LABEL, CONTACT_OUTCOME_ORDER } from "@/lib/contact-outcome";

type Member = {
  phone: string;
  name: string | null;
  lastBookingAt: string | null;
  bookings: number;
  state: "sent" | "failed" | null;
  csStatus: "open" | "waiting" | "resolved" | null;
  bookingStage: string | null;
  contactOutcome: string | null;
  labelIds: string[];
};

type Label = { id: string; name: string; color: string };

const CS_STATUS_LABEL: Record<string, string> = {
  open: "جاري المحادثة",
  waiting: "استفسار",
  resolved: "تم الطلب",
};

const dayFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Riyadh",
});

/**
 * Choosing an audience by hand, beside the recency segments.
 *
 * A segment answers "who booked lately". It cannot answer "the women we filed
 * as awaiting a booking", or "these four specific numbers" — and those are the
 * campaigns an employee actually wants to send. The filters here are the ones
 * the inbox already uses, so the same vocabulary picks the audience; ticking
 * names narrows it to exactly who she means.
 *
 * Selecting nobody is not a filter: it means the whole filtered list goes, as
 * it did before this panel existed.
 */
export function BroadcastAudience({
  templateKey,
  segment,
  disabled,
  selected,
  onSelectedChange,
}: {
  templateKey: string;
  segment: string;
  disabled: boolean;
  selected: string[];
  onSelectedChange: (phones: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [labelId, setLabelId] = useState("");
  const [status, setStatus] = useState("");
  const [bookingStage, setBookingStage] = useState("");
  const [contactOutcome, setContactOutcome] = useState("");
  const [search, setSearch] = useState("");
  const [includeSent, setIncludeSent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ segment });
      if (labelId) query.set("labelId", labelId);
      if (status) query.set("status", status);
      if (bookingStage) query.set("bookingStage", bookingStage);
      if (contactOutcome) query.set("contactOutcome", contactOutcome);
      if (search.trim()) query.set("search", search.trim());
      if (includeSent) query.set("includeSent", "1");
      const res = await fetch(`/api/broadcasts/${templateKey}/audience?${query}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "تعذّر تحميل القائمة");
        return;
      }
      setMembers(body.members ?? []);
      setLabels(body.labels ?? []);
    } catch {
      setError("انقطع الاتصال أثناء تحميل القائمة.");
    } finally {
      setLoading(false);
    }
  }, [templateKey, segment, labelId, status, bookingStage, contactOutcome, search, includeSent]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [open, load, search]);

  // A number that has dropped out of the current filter must not stay silently
  // selected: she would receive a campaign the employee can no longer see.
  const visiblePhones = useMemo(() => new Set(members.map((m) => m.phone)), [members]);
  const selectedHere = useMemo(
    () => selected.filter((phone) => visiblePhones.has(phone)),
    [selected, visiblePhones],
  );
  const labelsById = useMemo(
    () => new Map(labels.map((label) => [label.id, label.name])),
    [labels],
  );

  const toggle = (phone: string) => {
    onSelectedChange(
      selected.includes(phone)
        ? selected.filter((item) => item !== phone)
        : [...selected, phone],
    );
  };

  const selectField =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 focus:border-[var(--brand)] focus:outline-hidden";

  return (
    <div className="rounded-2xl border bg-[var(--surface)] p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Users className="size-4 text-[var(--brand)]" />
          اختيار العميلات يدويًا
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          {open ? "إخفاء القائمة" : "عرض القائمة والتصفية"}
        </button>
      </div>

      {selected.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--brand)] bg-[var(--brand-soft,#edf0ff)] px-3 py-2 text-xs font-semibold text-slate-800">
          <span>سيصل الإرسال إلى {selected.length} رقمًا محددًا فقط.</span>
          <button
            type="button"
            onClick={() => onSelectedChange([])}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 disabled:opacity-50"
          >
            <X className="size-3" /> إلغاء التحديد
          </button>
        </div>
      )}

      {open && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="relative">
              <Search className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="اسم أو رقم…"
                className="w-44 rounded-lg border border-slate-300 bg-white py-1.5 pr-7 pl-2.5 text-xs text-slate-800 focus:border-[var(--brand)] focus:outline-hidden"
              />
            </span>
            <select value={labelId} onChange={(e) => setLabelId(e.target.value)} className={selectField}>
              <option value="">كل التصنيفات</option>
              {labels.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectField}>
              <option value="">كل الحالات</option>
              {Object.entries(CS_STATUS_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={bookingStage}
              onChange={(e) => setBookingStage(e.target.value)}
              className={selectField}
            >
              <option value="">كل مراحل الحجز</option>
              {BOOKING_STAGE_ORDER.map((stage) => (
                <option key={stage} value={stage}>
                  {BOOKING_STAGE_LABEL[stage]}
                </option>
              ))}
            </select>
            <select
              value={contactOutcome}
              onChange={(e) => setContactOutcome(e.target.value)}
              className={selectField}
            >
              <option value="">كل نتائج التواصل</option>
              {CONTACT_OUTCOME_ORDER.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {CONTACT_OUTCOME_LABEL[outcome]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={includeSent}
                onChange={(e) => setIncludeSent(e.target.checked)}
                className="size-3.5 accent-[var(--brand)]"
              />
              إظهار من أُرسل لها
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <button
              type="button"
              disabled={disabled || !members.length}
              onClick={() =>
                onSelectedChange([
                  ...selected.filter((phone) => !visiblePhones.has(phone)),
                  ...members.map((member) => member.phone),
                ])
              }
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 disabled:opacity-50"
            >
              تحديد كل الظاهر ({members.length})
            </button>
            <button
              type="button"
              disabled={disabled || !selectedHere.length}
              onClick={() =>
                onSelectedChange(selected.filter((phone) => !visiblePhones.has(phone)))
              }
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 disabled:opacity-50"
            >
              إلغاء تحديد الظاهر
            </button>
            {loading && <Loader2 className="size-3.5 animate-spin" />}
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
              {error}
            </p>
          )}

          <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200">
            {!loading && !members.length ? (
              <p className="p-4 text-center text-xs text-muted-foreground">
                لا توجد عميلات مطابقة لهذه التصفية.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {members.map((member) => {
                  const checked = selected.includes(member.phone);
                  return (
                    <li key={member.phone}>
                      <label
                        className={`flex cursor-pointer items-center gap-3 px-3 py-2 transition ${
                          checked ? "bg-[var(--brand-soft,#edf0ff)]" : "hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(member.phone)}
                          className="size-4 shrink-0 accent-[var(--brand)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">
                              {member.name?.trim() || "بدون اسم"}
                            </span>
                            <span dir="ltr" className="text-xs tabular-nums text-muted-foreground">
                              {member.phone}
                            </span>
                            {member.state === "sent" && (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                أُرسلت
                              </span>
                            )}
                            {member.state === "failed" && (
                              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                                فشل الإرسال
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                            {member.lastBookingAt && (
                              <span>آخر حجز {dayFormatter.format(new Date(member.lastBookingAt))}</span>
                            )}
                            {member.bookings > 1 && <span>· {member.bookings} حجوزات</span>}
                            {member.csStatus && <span>· {CS_STATUS_LABEL[member.csStatus]}</span>}
                            {member.bookingStage && (
                              <span>
                                ·{" "}
                                {BOOKING_STAGE_LABEL[
                                  member.bookingStage as keyof typeof BOOKING_STAGE_LABEL
                                ] ?? member.bookingStage}
                              </span>
                            )}
                            {member.labelIds.map((id) => (
                              <span
                                key={id}
                                className="rounded-full bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600"
                              >
                                {labelsById.get(id) ?? "تصنيف"}
                              </span>
                            ))}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
