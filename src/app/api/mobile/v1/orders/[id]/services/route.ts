import { after } from "next/server";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
} from "@/lib/mobile/http";
import {
  listServiceChanges,
  previewServiceChange,
  approveServiceChange,
  dismissServiceChange,
  drainServiceNotifications,
} from "@/lib/order-service-changes";
export const maxDuration = 60;
async function handle(request: Request, params: Promise<{ id: string }>) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  const session = auth.session;
  const { id } = await params;
  try {
    let data: unknown;
    if (request.method === "GET") data = await listServiceChanges(id);
    else {
      const body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new Error("طلب غير صحيح");
      if (body.action === "approve") {
        data = await approveServiceChange(id, body, session);
        after(() =>
          drainServiceNotifications(id).catch((error) =>
            console.error("[service-notifications]", error),
          ),
        );
      } else if (body.action === "dismiss")
        data = await dismissServiceChange(id, body);
      else if (body.action === "preview")
        data = await previewServiceChange(id, body, session);
      else throw new Error("طلب غير صحيح");
    }
    return mobileData(data);
  } catch (error) {
    const raw = error instanceof Error ? error.message : "تعذّر تعديل الخدمات";
    const conflict = /CONFLICT|REKAZ_CHANGED|duplicate key/.test(raw);
    const unavailable =
      /order_visit_services|order_service_|schema cache/i.test(raw);
    const status =
      raw === "ORDER_NOT_FOUND"
        ? 404
        : conflict
          ? 409
          : unavailable
            ? 503
            : 400;
    const message = conflict
      ? "تغيّر الطلب أو حجز ركاز. حدّثي البيانات وراجعي التأكيد من جديد."
      : raw;
    return mobileError(status, "SERVICE_CHANGE_FAILED", message);
  }
}
export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(request, params);
}
export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(request, params);
}
