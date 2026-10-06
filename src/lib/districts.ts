import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import type { District } from "@/lib/types";

/**
 * Districts and their trip fares.
 *
 * The table is server-only (no RLS policies, no API-role grants), so every
 * read and write goes through the service role here, behind the routes' own
 * role checks. Choosing a district on an order is open to every employee; the
 * fare that comes with it is visible to, and editable by, admins only.
 */

const COLS = "id, name, trip_price, is_active";

export class DistrictError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type DistrictRow = { id: string; name: string; trip_price: number | string; is_active: boolean };

function toDistrict(row: DistrictRow, withPrice: boolean): District {
  return {
    id: row.id,
    name: row.name,
    trip_price: withPrice ? Number(row.trip_price) : null,
    is_active: row.is_active,
  };
}

/** Postgres unique violation on (restaurant, name). */
function duplicateName(error: { code?: string } | null) {
  return error?.code === "23505";
}

export async function listDistricts(opts: {
  activeOnly?: boolean;
  withPrice: boolean;
}): Promise<District[]> {
  let query = getAdminSupabaseClient()
    .from("districts")
    .select(COLS)
    .eq("restaurant_id", KIARA_RESTAURANT_ID);
  if (opts.activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query.order("name");
  if (error) {
    // Deploy ahead of the migration: no districts yet, not a broken screen.
    if (error.message.includes("districts")) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as DistrictRow[]).map((row) => toDistrict(row, opts.withPrice));
}

/** Names for the ids an order list references — archived ones included. */
export async function districtNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await getAdminSupabaseClient()
    .from("districts")
    .select("id, name")
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .in("id", ids);
  if (error) return new Map();
  return new Map((data ?? []).map((row) => [row.id as string, row.name as string]));
}

export function parseDistrictName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 80) {
    throw new DistrictError("اسم الحي مطلوب (من حرفين إلى 80 حرفًا)");
  }
  return name;
}

export function parseTripPrice(raw: unknown): number {
  const value =
    typeof raw === "number"
      ? raw
      : Number(
          String(raw ?? "")
            .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
            .replace(/[٫,]/g, ".")
            .trim(),
        );
  if (raw === "" || raw == null || !Number.isFinite(value) || value < 0 || value > 10_000) {
    throw new DistrictError("تكلفة المشوار يجب أن تكون بين 0 و10,000 ريال");
  }
  return Math.round(value * 100) / 100;
}

export async function createDistrict(
  userId: string,
  input: { name: string; tripPrice: number },
): Promise<District> {
  const { data, error } = await getAdminSupabaseClient()
    .from("districts")
    .insert({
      restaurant_id: KIARA_RESTAURANT_ID,
      name: input.name,
      trip_price: input.tripPrice,
      created_by: userId,
      updated_by: userId,
    })
    .select(COLS)
    .single();
  if (duplicateName(error)) throw new DistrictError("يوجد حي بهذا الاسم", 409);
  if (error) throw new Error(error.message);
  return toDistrict(data as DistrictRow, true);
}

export async function updateDistrict(
  userId: string,
  id: string,
  patch: { name?: string; tripPrice?: number; isActive?: boolean },
): Promise<District> {
  const { data, error } = await getAdminSupabaseClient()
    .from("districts")
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.tripPrice !== undefined ? { trip_price: patch.tripPrice } : {}),
      ...(patch.isActive !== undefined ? { is_active: patch.isActive } : {}),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .select(COLS)
    .maybeSingle();
  if (duplicateName(error)) throw new DistrictError("يوجد حي بهذا الاسم", 409);
  if (error) throw new Error(error.message);
  if (!data) throw new DistrictError("الحي غير موجود", 404);
  return toDistrict(data as DistrictRow, true);
}

/**
 * Delete a district nobody has used; archive one that past orders name, so
 * their trip keeps its district and its fare. Archived districts drop out of
 * every picker.
 */
export async function deleteDistrict(
  userId: string,
  id: string,
): Promise<{ archived: boolean }> {
  const admin = getAdminSupabaseClient();
  const { count, error: countError } = await admin
    .from("driver_orders")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .eq("district_id", id);
  if (countError) throw new Error(countError.message);

  if (count) {
    await updateDistrict(userId, id, { isActive: false });
    return { archived: true };
  }

  const { data, error } = await admin
    .from("districts")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", KIARA_RESTAURANT_ID)
    .select("id");
  // Raced with an order picking it between the count and the delete.
  if (error?.code === "23503") {
    await updateDistrict(userId, id, { isActive: false });
    return { archived: true };
  }
  if (error) throw new Error(error.message);
  if (!data?.length) throw new DistrictError("الحي غير موجود", 404);
  return { archived: false };
}

const DISTRICT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An order's `districtId` from a request body: undefined when absent, null
 * when cleared (blank counts as cleared), otherwise a uuid.
 */
export function parseOrderDistrictId(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  if (!DISTRICT_ID.test(value)) throw new DistrictError("الحي غير صحيح");
  return value;
}

/** The commands refuse an archived or foreign district with this code. */
export function isDistrictUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.includes("DISTRICT_NOT_AVAILABLE");
}

export const DISTRICT_UNAVAILABLE_MESSAGE =
  "هذا الحي لم يعد متاحًا. اختاري حيًا آخر من القائمة.";
