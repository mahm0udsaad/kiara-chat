import { getDriverOrderById, updateDriverOrder } from "@/lib/dispatch";
import {
  authorizeMobileRequest,
  mobileData,
  mobileError,
  mobileServerError,
} from "@/lib/mobile/http";
import { orderForMobileSession } from "@/lib/mobile/orders";
import { OperationalCommandError } from "@/lib/operational-commands";
import { uploadBase64Media } from "@/lib/storage-media";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DOOR_PHOTO_BYTES = 4 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return mobileError(400, "INVALID_FORM", "Invalid multipart body");
  }
  const photo = form.get("doorPhoto");
  const expectedVersion = Number(form.get("expectedVersion"));
  const idempotencyKey = String(form.get("idempotencyKey") ?? "").trim();
  if (!(photo instanceof File) || photo.size <= 0) {
    return mobileError(400, "DOOR_PHOTO_REQUIRED", "Door photo is required");
  }
  if (!photo.type.startsWith("image/")) {
    return mobileError(415, "DOOR_PHOTO_NOT_IMAGE", "The door photo must be an image");
  }
  if (photo.size > MAX_DOOR_PHOTO_BYTES) {
    return mobileError(413, "DOOR_PHOTO_TOO_LARGE", "The door photo is too large");
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return mobileError(400, "EXPECTED_VERSION_REQUIRED", "expectedVersion must be a positive integer");
  }
  if (!UUID.test(idempotencyKey)) {
    return mobileError(400, "IDEMPOTENCY_KEY_REQUIRED", "idempotencyKey must be a UUID");
  }

  const { id } = await params;
  try {
    const current = await getDriverOrderById(id);
    if (!current) return mobileError(404, "ORDER_NOT_FOUND", "Order not found");
    if (current.door_photo_path) {
      return mobileError(409, "DOOR_PHOTO_EXISTS", "This order already has a door photo");
    }
    const uploaded = await uploadBase64Media({
      restaurantId: KIARA_RESTAURANT_ID,
      conversationId: current.conversation_id,
      contentType: photo.type,
      base64: Buffer.from(await photo.arrayBuffer()).toString("base64"),
      originalFilename: photo.name || "door.jpg",
    });
    if (!uploaded.storage_path) {
      throw new Error(uploaded.fetch_error || "Door photo upload failed");
    }
    const order = await updateDriverOrder(
      id,
      { doorPhotoPath: uploaded.storage_path },
      {
        expectedVersion,
        idempotencyKey,
        actor: {
          userId: auth.session.userId,
          teamMemberId: auth.session.teamMemberId,
          role: auth.session.role,
        },
      },
    );
    return mobileData({ order: orderForMobileSession(order, auth.session) });
  } catch (error) {
    if (error instanceof OperationalCommandError && error.isConflict) {
      return mobileError(409, error.code, "The order changed. Refresh and try again.");
    }
    return mobileServerError(error, "DOOR_PHOTO_UPLOAD_FAILED", "Unable to add the door photo");
  }
}
