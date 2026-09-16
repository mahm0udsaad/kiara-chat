"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Eye,
  MessageSquare,
  RefreshCw,
  Send,
  Users,
  Search,
  ExternalLink,
  Flame,
  AlertCircle,
  Clock,
  Sparkles,
  CheckCheck,
} from "lucide-react";
import type {
  BroadcastAnalyticsResult,
  CustomerCampaignEvent,
} from "@/lib/broadcast-analytics";

export function BroadcastAnalyticsView({ templateKey }: { templateKey: string }) {
  const [data, setData] = useState<BroadcastAnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "replied" | "read" | "delivered" | "sent">("all");
  const [search, setSearch] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/broadcasts/${templateKey}/analytics`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "تعذّر جلب البيانات");
      }
      const json: BroadcastAnalyticsResult = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ أثناء تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }, [templateKey]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <RefreshCw className="size-6 animate-spin text-[var(--brand)]" />
        <span className="text-sm font-medium">جارٍ تحليل تفاعل وردود العملاء…</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-red-800">
        <AlertCircle className="mx-auto mb-2 size-6 text-red-600" />
        <p className="font-semibold">{error}</p>
        <button
          type="button"
          onClick={loadData}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
        >
          <RefreshCw className="size-3.5" /> إعادة المحاولة
        </button>
      </div>
    );
  }

  const s = data?.summary;
  const feed = data?.feed ?? [];

  // Filter and search feed
  const filteredFeed = feed.filter((item) => {
    if (filter === "replied" && item.status !== "replied") return false;
    if (filter === "read" && item.status !== "read" && item.status !== "replied") return false;
    if (filter === "delivered" && item.status !== "delivered" && item.status !== "read" && item.status !== "replied") return false;
    if (filter === "sent" && item.status !== "sent") return false;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchPhone = item.phone.toLowerCase().includes(q);
      const matchName = (item.name ?? "").toLowerCase().includes(q);
      const matchMsg = (item.lastCustomerMessage ?? "").toLowerCase().includes(q);
      return matchPhone || matchName || matchMsg;
    }
    return true;
  });

  const formatTime = (iso: string | null) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString("ar-SA", {
        hour: "2-digit",
        minute: "2-digit",
        day: "numeric",
        month: "short",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Banner & Health Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-gradient-to-r from-[var(--surface)] to-[var(--brand-soft)]/40 p-5 shadow-xs">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-[var(--foreground)]">
              تحليلات حملة: {s?.templateLabel}
            </h2>
            {s && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  s.healthTone === "excellent"
                    ? "bg-amber-100 text-amber-800 border border-amber-300"
                    : s.healthTone === "good"
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      : "bg-slate-100 text-slate-700 border border-slate-200"
                }`}
              >
                {s.healthTone === "excellent" && <Flame className="size-3.5 text-amber-600" />}
                {s.healthTone === "good" && <Sparkles className="size-3.5 text-emerald-600" />}
                {s.healthLabel}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            تتبع نسبة المشاهدة (Seen) والتفاعل والردود المستلمة من العملاء فور وصول التنويه
          </p>
        </div>

        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          تحديث التحليلات
        </button>
      </div>

      {/* KPI 4 Cards Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Total Sent */}
        <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">تم الإرسال</span>
            <div className="rounded-lg bg-blue-50 p-1.5 text-blue-600">
              <Send className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-black tracking-tight tabular-nums text-slate-900">
            {s?.sent ?? 0}
          </div>
          <span className="text-[11px] text-muted-foreground">
            من إجمالي {s?.totalAudience ?? 0} عميلة ({s?.totalAudience ? Math.round(((s.sent) / s.totalAudience) * 100) : 0}%)
          </span>
        </div>

        {/* Delivered */}
        <div className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">تم الاستلام</span>
            <div className="rounded-lg bg-slate-100 p-1.5 text-slate-700">
              <CheckCheck className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-black tracking-tight tabular-nums text-slate-900">
            {s?.delivered ?? 0}
          </div>
          <span className="text-[11px] text-emerald-600 font-medium">
            معدل استلام {s?.deliveryRate ?? 0}%
          </span>
        </div>

        {/* Read / Seen */}
        <div className="flex flex-col gap-1 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-indigo-900">تمت المشاهدة (Seen)</span>
            <div className="rounded-lg bg-indigo-100 p-1.5 text-indigo-700">
              <Eye className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-black tracking-tight tabular-nums text-indigo-950">
            {s?.read ?? 0}
          </div>
          <span className="text-[11px] text-indigo-700 font-medium">
            معدل قراءة {s?.readRate ?? 0}%
          </span>
        </div>

        {/* Replied / Responses */}
        <div className="flex flex-col gap-1 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-900">أرسلن رداً (Replied)</span>
            <div className="rounded-lg bg-emerald-200 p-1.5 text-emerald-800">
              <MessageSquare className="size-4" />
            </div>
          </div>
          <div className="text-2xl font-black tracking-tight tabular-nums text-emerald-950">
            {s?.replied ?? 0}
          </div>
          <span className="text-[11px] text-emerald-700 font-bold">
            معدل الرد {s?.replyRate ?? 0}%
          </span>
        </div>
      </div>

      {/* Conversion Funnel Bar */}
      <div className="rounded-2xl border bg-white p-5 shadow-xs">
        <h3 className="mb-3 text-sm font-bold text-slate-900">مسار التحويل والتفاعل (Funnel)</h3>
        <div className="flex flex-col gap-2">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              title={`أرسلن رداً: ${s?.replied}`}
              className="bg-emerald-500 transition-all duration-500"
              style={{ width: `${s?.totalAudience ? (s.replied / s.totalAudience) * 100 : 0}%` }}
            />
            <div
              title={`شاهدن الرسالة: ${s?.read}`}
              className="bg-indigo-500 transition-all duration-500"
              style={{ width: `${s?.totalAudience ? (Math.max(0, s.read - s.replied) / s.totalAudience) * 100 : 0}%` }}
            />
            <div
              title={`تم الاستلام: ${s?.delivered}`}
              className="bg-sky-400 transition-all duration-500"
              style={{ width: `${s?.totalAudience ? (Math.max(0, s.delivered - s.read) / s.totalAudience) * 100 : 0}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-emerald-500" />
              <span>ردود مستلمة: <strong className="text-slate-900">{s?.replied ?? 0}</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-indigo-500" />
              <span>تمت القراءة: <strong className="text-slate-900">{s?.read ?? 0}</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-sky-400" />
              <span>تم الاستلام: <strong className="text-slate-900">{s?.delivered ?? 0}</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-slate-200" />
              <span>المتبقي للإرسال: <strong className="text-slate-900">{s?.pending ?? 0}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Customer Responses Table / Feed */}
      <div className="rounded-2xl border bg-white shadow-xs overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-[var(--brand)]" />
            <h3 className="text-sm font-bold text-slate-900">سجل وتفاعل العميلات</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
              {filteredFeed.length}
            </span>
          </div>

          {/* Search & Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute right-2.5 top-2.5 size-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالرقم أو الاسم…"
                className="h-8 rounded-lg border border-slate-200 bg-white pr-8 pl-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[var(--brand)] focus:outline-hidden"
              />
            </div>

            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`rounded-md px-2.5 py-1 transition ${
                  filter === "all" ? "bg-white text-slate-900 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                الكل ({feed.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("replied")}
                className={`rounded-md px-2.5 py-1 transition ${
                  filter === "replied" ? "bg-emerald-600 text-white shadow-2xs font-bold" : "text-emerald-700 hover:text-emerald-900"
                }`}
              >
                ردوا ({s?.replied ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setFilter("read")}
                className={`rounded-md px-2.5 py-1 transition ${
                  filter === "read" ? "bg-indigo-600 text-white shadow-2xs font-bold" : "text-indigo-700 hover:text-indigo-900"
                }`}
              >
                شاهدوا ({s?.read ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setFilter("delivered")}
                className={`rounded-md px-2.5 py-1 transition ${
                  filter === "delivered" ? "bg-slate-800 text-white shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                وصلت ({s?.delivered ?? 0})
              </button>
            </div>
          </div>
        </div>

        {/* Responses Table */}
        <div className="overflow-x-auto">
          {filteredFeed.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              لا توجد نتائج مطابقة للبحث أو الفلتر الحالي.
            </div>
          ) : (
            <table className="w-full text-right text-xs">
              <thead className="border-b border-slate-100 bg-slate-50/70 text-slate-500 font-semibold">
                <tr>
                  <th className="px-4 py-3">العميلة</th>
                  <th className="px-4 py-3">الحالة والتفاعل</th>
                  <th className="px-4 py-3">آخر رسالة من العميلة</th>
                  <th className="px-4 py-3">وقت الإرسال</th>
                  <th className="px-4 py-3 text-left">المحادثة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredFeed.map((item) => {
                  return (
                    <tr key={item.customerId} className="hover:bg-slate-50/60 transition">
                      {/* Name & Phone */}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">
                          {item.name || "عميلة بدون اسم"}
                        </div>
                        <div dir="ltr" className="text-[11px] text-slate-500 font-mono">
                          {item.phone}
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td className="px-4 py-3">
                        {item.status === "replied" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800 border border-emerald-300">
                            <MessageSquare className="size-3 text-emerald-600" />
                            أرسلت ردًا 💬
                          </span>
                        )}
                        {item.status === "read" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 border border-indigo-200">
                            <Eye className="size-3 text-indigo-600" />
                            شوهدت الرسالة
                          </span>
                        )}
                        {item.status === "delivered" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            <CheckCheck className="size-3 text-slate-500" />
                            تم التسليم
                          </span>
                        )}
                        {item.status === "sent" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                            <Send className="size-3 text-blue-500" />
                            تم الإرسال
                          </span>
                        )}
                      </td>

                      {/* Last Message Snippet */}
                      <td className="px-4 py-3 max-w-[280px]">
                        {item.lastCustomerMessage ? (
                          <div className="truncate rounded-md bg-slate-100/80 px-2 py-1 text-slate-800 font-medium border border-slate-200/60">
                            &ldquo;{item.lastCustomerMessage}&rdquo;
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">لا يوجد رد بعد</span>
                        )}
                      </td>

                      {/* Sent / Replied Time */}
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                        <div>{formatTime(item.sentAt)}</div>
                        {item.repliedAt && (
                          <div className="text-[10px] text-emerald-700 font-semibold">
                            الرد: {formatTime(item.repliedAt)}
                          </div>
                        )}
                      </td>

                      {/* Conversation Link */}
                      <td className="px-4 py-3 text-left">
                        {item.conversationId ? (
                          <Link
                            href={`/inbox?conversation=${item.conversationId}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-[var(--brand)] hover:bg-[var(--brand-soft)] transition"
                          >
                            <span>فتح</span>
                            <ExternalLink className="size-3" />
                          </Link>
                        ) : (
                          <span className="text-slate-400 text-[11px]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
