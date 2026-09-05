import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID, type KiaraSession } from "@/lib/tenant";
import { normalizePhone } from "@/lib/phone";
import {
  planServiceChange,
  serviceFingerprint,
} from "@/lib/service-change-planning";
import { specialistLanguageOf } from "@/lib/specialist-languages";
import { translateMessage } from "@/lib/translate";
import { notifyFieldStaffReminder } from "@/lib/field-push";

type Row = Record<string, unknown>;
const db = () => getAdminSupabaseClient();
const tenant = KIARA_RESTAURANT_ID;
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(
    new Date(iso),
  );
const time = (iso: string) =>
  new Intl.DateTimeFormat("ar-SA", {
    timeZone: "Asia/Riyadh",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
async function context(orderId: string) {
  const [order, progress, services] = await Promise.all([
    db()
      .from("driver_orders")
      .select("*")
      .eq("restaurant_id", tenant)
      .eq("id", orderId)
      .maybeSingle(),
    db()
      .from("field_order_progress")
      .select("service_started_at, completed_at, driver_returned_at")
      .eq("restaurant_id", tenant)
      .eq("order_id", orderId)
      .maybeSingle(),
    db()
      .from("order_visit_services")
      .select("*")
      .eq("restaurant_id", tenant)
      .eq("order_id", orderId)
      .order("starts_at"),
  ]);
  [order.error, progress.error, services.error].forEach(check);
  if (!order.data) throw new Error("ORDER_NOT_FOUND");
  return {
    order: order.data,
    services: services.data ?? [],
    progress: {
      started: progress.data?.service_started_at ?? null,
      completed: progress.data?.completed_at ?? null,
      returned: progress.data?.driver_returned_at ?? null,
    },
  };
}
export async function listServiceChanges(orderId: string) {
  const ctx = await context(orderId);
  const from = new Date(
    Date.parse(ctx.order.arrival_at) - 86400_000,
  ).toISOString();
  const to = new Date(
    Date.parse(ctx.order.arrival_at) + 2 * 86400_000,
  ).toISOString();
  const [reservations, dismissals, notifications, sync, specialist] =
    await Promise.all([
      db()
        .from("rekaz_reservations")
        .select("source_id,payload,payload_hash,arrival_at,removed_at,status")
        .eq("restaurant_id", tenant)
        .gte("arrival_at", from)
        .lte("arrival_at", to),
      db()
        .from("order_service_dismissals")
        .select("source_id,payload_hash")
        .eq("restaurant_id", tenant)
        .eq("order_id", orderId),
      db()
        .from("order_service_notifications")
        .select("id,role,status,last_error,body")
        .eq("restaurant_id", tenant)
        .eq("order_id", orderId)
        .order("updated_at", { ascending: false })
        .limit(20),
      db()
        .from("rekaz_sync_runs")
        .select("completed_at")
        .eq("restaurant_id", tenant)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1),
      db()
        .from("specialists")
        .select("full_name")
        .eq("restaurant_id", tenant)
        .eq(
          "id",
          ctx.order.specialist_id ?? "00000000-0000-0000-0000-000000000000",
        )
        .maybeSingle(),
    ]);
  [
    reservations.error,
    dismissals.error,
    notifications.error,
    sync.error,
    specialist.error,
  ].forEach(check);
  const ids = (reservations.data ?? []).map((r) => r.source_id);
  const links = ids.length
    ? await db()
        .from("order_visit_services")
        .select("source_id,order_id")
        .eq("restaurant_id", tenant)
        .in("source_id", ids)
    : { data: [], error: null };
  check(links.error);
  const candidates = (reservations.data ?? []).flatMap((r) => {
    const p = r.payload as Row;
    if (
      r.removed_at ||
      ["Cancelled", "Done"].includes(r.status) ||
      ctx.progress.completed ||
      ctx.progress.returned
    )
      return [];
    if (
      (links.data ?? []).some(
        (l) => l.source_id === r.source_id && l.order_id !== orderId,
      )
    )
      return [];
    if (
      (dismissals.data ?? []).some(
        (d) => d.source_id === r.source_id && d.payload_hash === r.payload_hash,
      )
    )
      return [];
    const existing = ctx.services.find((s) => s.source_id === r.source_id);
    if (
      existing &&
      serviceFingerprint(existing.source_payload ?? {}) ===
        serviceFingerprint(p)
    )
      return [];
    if (
      !existing &&
      (!normalizePhone(String(p.customerPhone ?? "")) ||
        normalizePhone(String(p.customerPhone)) !==
          normalizePhone(ctx.order.customer_phone))
    )
      return [];
    if (!existing && day(r.arrival_at) !== day(ctx.order.arrival_at)) return [];
    const end =
      Date.parse(ctx.progress.started ?? ctx.order.arrival_at) +
      ctx.order.duration_minutes * 60_000;
    if (
      !existing &&
      (Date.parse(r.arrival_at) > end + 60 * 60_000 ||
        Date.parse(r.arrival_at) <
          Date.parse(ctx.order.arrival_at) - 30 * 60_000)
    )
      return [];
    const providers = Array.isArray(p.providers) ? p.providers : [];
    const reasons = ["نفس العميلة ووقت قريب من الزيارة"];
    if (providers.includes(specialist.data?.full_name))
      reasons.push("نفس الأخصائية");
    else
      reasons.push(
        "راجعي الأخصائية: " + (providers.join("، ") || "غير محددة في ركاز"),
      );
    const location = p.location as { label?: string } | null;
    reasons.push(
      "موقع ركاز: " + (location?.label || "غير محدد — تحققي من أنه نفس الموقع"),
    );
    return [
      {
        sourceId: r.source_id,
        sourceHash: r.payload_hash,
        name: String(p.service ?? ""),
        minutes: Number(p.durationMinutes),
        serviceId: existing?.id ?? null,
        kind: existing ? "update" : "addition",
        reasons,
      },
    ];
  });
  return {
    services: ctx.services.map((s) => ({
      id: s.id,
      name: s.name,
      minutes: s.minutes,
      sourceId: s.source_id,
    })),
    candidates,
    notifications: notifications.data ?? [],
    syncedAt: sync.data?.[0]?.completed_at ?? null,
    canAdd:
      ctx.order.status === "sent" &&
      !ctx.progress.completed &&
      !ctx.progress.returned &&
      !!ctx.order.specialist_id &&
      !!ctx.order.driver_id,
  };
}

export async function previewServiceChange(
  orderId: string,
  input: Row,
  session: KiaraSession,
) {
  const { order, services, progress } = await context(orderId);
  if (progress.completed || progress.returned)
    throw new Error("انتهت الزيارة؛ أنشئي زيارة جديدة للخدمة الجديدة.");
  if (order.status !== "sent")
    throw new Error("أرسلي الطلب للأخصائية والسائق أولًا.");
  if (!order.specialist_id || !order.driver_id)
    throw new Error("حددي الأخصائية والسائق أولًا.");
  let source: Row | null = null;
  if (typeof input.sourceId === "string" && input.sourceId) {
    const result = await db()
      .from("rekaz_reservations")
      .select("*")
      .eq("restaurant_id", tenant)
      .eq("source_id", input.sourceId)
      .maybeSingle();
    check(result.error);
    source = result.data;
    if (
      !source ||
      source.removed_at ||
      ["Cancelled", "Done"].includes(String(source.status))
    )
      throw new Error("الحجز غير متاح في ركاز.");
    const p = source.payload as Row;
    if (
      !normalizePhone(String(p.customerPhone ?? "")) ||
      normalizePhone(String(p.customerPhone)) !==
        normalizePhone(order.customer_phone)
    )
      throw new Error("حجز ركاز لعميلة مختلفة.");
    const linked = await db()
      .from("order_visit_services")
      .select("order_id")
      .eq("restaurant_id", tenant)
      .eq("source_id", input.sourceId)
      .maybeSingle();
    check(linked.error);
    if (linked.data && linked.data.order_id !== orderId)
      throw new Error("الخدمة مرتبطة بزيارة أخرى.");
  }
  const existing = input.serviceId
    ? services.find((s) => s.id === input.serviceId)
    : services.find((s) => source && s.source_id === source.source_id);
  if (input.serviceId && !existing)
    throw new Error("الخدمة غير موجودة في هذه الزيارة.");
  if (
    input.reconcile &&
    existing &&
    Number((source?.payload as Row)?.durationMinutes) !== existing.minutes
  )
    throw new Error(
      "مدة حجز ركاز تختلف عن الخدمة اليدوية. عدّلي مدة الخدمة اليدوية أولًا ثم اربطيها.",
    );
  if (input.reconcile && (!source || !existing || existing.source_id))
    throw new Error("اختاري خدمة يدوية غير مرتبطة بموضوع ركاز.");
  const p = (source?.payload ?? {}) as Row;
  const name = String(source ? (p.service ?? "") : (input.name ?? "")).trim();
  const minutes = Number(source ? p.durationMinutes : input.minutes);
  if (
    source &&
    existing?.source_id &&
    serviceFingerprint(existing.source_payload ?? {}) === serviceFingerprint(p)
  )
    throw new Error("هذه الخدمة معتمدة بالفعل ولم تتغير.");
  if (!name || name.length > 300)
    throw new Error("اسم الخدمة مطلوب، بحد أقصى ٣٠٠ حرف.");
  if (source && day(String(source.arrival_at)) !== day(order.arrival_at))
    throw new Error("الحجز ليس في يوم هذه الزيارة.");
  const timing = planServiceChange({
    arrivalAt: order.arrival_at,
    durationMinutes: order.duration_minutes,
    serviceStartedAt: progress.started,
    minutes,
    previousMinutes: existing
      ? input.reconcile
        ? minutes
        : existing.minutes
      : undefined,
    previousStartsAt: existing?.starts_at,
    requestedStart: existing
      ? source && !input.reconcile && existing.source_payload?.arrivalAt
        ? new Date(
            Date.parse(existing.starts_at) +
              Date.parse(String(source.arrival_at)) -
              Date.parse(existing.source_payload.arrivalAt),
          ).toISOString()
        : existing.starts_at
      : typeof input.startsAt === "string" && input.startsAt
        ? input.startsAt
        : source
          ? String(source.arrival_at)
          : undefined,
    now: new Date().toISOString(),
  });
  const conflicts = await db()
    .from("driver_orders")
    .select("id,arrival_at,duration_minutes,specialist_id,driver_id")
    .eq("restaurant_id", tenant)
    .neq("id", orderId)
    .gte("arrival_at", timing.oldEnd)
    .lt("arrival_at", timing.newEnd)
    .or(
      `specialist_id.eq.${order.specialist_id},driver_id.eq.${order.driver_id}`,
    );
  check(conflicts.error);
  if (conflicts.data?.length)
    throw new Error(
      "التمديد يتعارض مع موعد تالٍ للأخصائية أو السائق. عدّلي إسناد الموعد التالي أولًا.",
    );
  const extension = timing.extensionMinutes;
  const specialistTitle = "تحديث خدمات الزيارة";
  const driverTitle = "تحديث موعد استلام الأخصائية";
  let specialistMessage = `${existing ? "تم تعديل" : "تمت إضافة"} خدمة ${name} (${minutes} دقيقة) واعتماد تنفيذها ضمن زيارة العميلة ${order.customer_phone}.\nالانتهاء المتوقع: ${time(timing.newEnd)}.`;
  const driverMessage = `تحديث زيارة العميلة ${order.customer_phone}: ${name}.\n${extension > 0 ? `زاد وقت الانتظار المتوقع ${extension} دقيقة بسبب الخدمة المضافة.` : extension < 0 ? `انخفضت مدة الزيارة ${-extension} دقيقة.` : "لم يتغير وقت الانتظار المتوقع."}\n${order.trip_type === "round_trip" ? "موعد استلام الأخصائية المتوقع" : "وقت انتهاء الزيارة المتوقع (الرحلة ذهاب فقط)"}: ${time(timing.newEnd)}.`;
  const specialist = await db()
    .from("specialists")
    .select("nationality,preferred_language")
    .eq("restaurant_id", tenant)
    .eq("id", order.specialist_id)
    .single();
  check(specialist.error);
  const language = specialistLanguageOf(
    specialist.data?.nationality,
    specialist.data?.preferred_language,
  );
  if (language.targetLanguage)
    specialistMessage =
      (await translateMessage(specialistMessage, language.targetLanguage)) ||
      specialistMessage;
  const payload = {
    name,
    minutes,
    ...timing,
    sourceId: source?.source_id ?? null,
    sourceHash: source?.payload_hash ?? null,
    serviceId: existing?.id ?? null,
    specialistTitle,
    driverTitle,
  };
  const result = await db()
    .from("order_service_previews")
    .insert({
      restaurant_id: tenant,
      order_id: orderId,
      actor_user_id: session.userId,
      expected_version: order.version,
      progress_snapshot: progress,
      payload,
    })
    .select("id")
    .single();
  check(result.error);
  return { id: result.data!.id, ...payload, specialistMessage, driverMessage };
}

export async function approveServiceChange(
  orderId: string,
  input: Row,
  session: KiaraSession,
) {
  if (typeof input.previewId !== "string") throw new Error("PREVIEW_NOT_FOUND");
  const result = await db().rpc("kiara_approve_service_change", {
    p_restaurant_id: tenant,
    p_order_id: orderId,
    p_preview_id: input.previewId,
    p_actor_user_id: session.userId,
    p_actor_team_member_id: session.teamMemberId,
    p_actor_role: session.role,
    p_specialist_message:
      typeof input.specialistMessage === "string"
        ? input.specialistMessage
        : "",
    p_driver_message:
      typeof input.driverMessage === "string" ? input.driverMessage : "",
  });
  check(result.error);
  return result.data;
}
export async function dismissServiceChange(orderId: string, input: Row) {
  const listing = await listServiceChanges(orderId);
  const candidate = listing.candidates.find(
    (c) => c.sourceId === input.sourceId,
  );
  if (!candidate) throw new Error("حدّثي اقتراحات ركاز أولًا.");
  const result = await db().from("order_service_dismissals").upsert({
    restaurant_id: tenant,
    order_id: orderId,
    source_id: candidate.sourceId,
    payload_hash: candidate.sourceHash,
  });
  check(result.error);
  return { dismissed: true };
}
/** At-least-once delivery. A crashed claim is retried; the service itself is never repeated. */
export async function drainServiceNotifications(orderId?: string) {
  let query = db()
    .from("order_service_notifications")
    .select("*")
    .eq("restaurant_id", tenant)
    .in("status", ["pending", "failed", "processing"])
    .lt("attempts", 5)
    .order("updated_at")
    .limit(20);
  if (orderId) query = query.eq("order_id", orderId);
  const result = await query;
  check(result.error);
  for (const job of result.data ?? []) {
    if (
      job.status === "processing" &&
      Date.parse(job.updated_at) > Date.now() - 120_000
    )
      continue;
    if (
      job.status === "failed" &&
      Date.parse(job.updated_at) > Date.now() - 60_000
    )
      continue;
    const claim = await db()
      .from("order_service_notifications")
      .update({
        status: "processing",
        attempts: job.attempts + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", job.status)
      .eq("updated_at", job.updated_at)
      .select("id");
    check(claim.error);
    if (!claim.data?.length) continue;
    let error: string | null = null;
    try {
      const delivery = await notifyFieldStaffReminder({
        orderId: job.order_id,
        role: job.role,
        rosterId: job.roster_id,
        title: job.title,
        body: job.body,
      });
      if (!delivery.accepted)
        error = delivery.attempted ? "PUSH_REJECTED" : "NO_REGISTERED_DEVICE";
    } catch {
      error = "PUSH_DELIVERY_FAILED";
    }
    const finished = await db()
      .from("order_service_notifications")
      .update({
        status: error ? "failed" : "accepted",
        last_error: error,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("attempts", job.attempts + 1);
    check(finished.error);
  }
}
