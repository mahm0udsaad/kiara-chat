/**
 * Which image each media template goes out with.
 *
 * Meta requires the header image on every send, but does not reliably hand the
 * approved one back in a form it will fetch again — which is why a single
 * `META_TEMPLATE_HEADER_IMAGE_URL` exists. A single URL is wrong the moment a
 * second media template exists: an offer would go out wearing the logo. So the
 * sample image uploaded while creating a template is remembered against that
 * template, in `restaurants.metadata.templateHeaderImages`, and signed fresh at
 * send time.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";
import { WHATSAPP_MEDIA_BUCKET } from "@/lib/storage-media";

/** Long enough for Meta to fetch it; short enough that a leaked link dies. */
const SEND_URL_TTL_SECONDS = 60 * 60;

const keyOf = (name: string, language: string) => `${name}:${language}`;

/** The bucket path behind one of our own signed storage URLs, if it is one. */
export function storagePathFromSignedUrl(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const marker = `/storage/v1/object/sign/${WHATSAPP_MEDIA_BUCKET}/`;
    const at = pathname.indexOf(marker);
    return at >= 0 ? decodeURIComponent(pathname.slice(at + marker.length)) : null;
  } catch {
    return null;
  }
}

async function readMap(): Promise<{ meta: Record<string, unknown>; map: Record<string, string> }> {
  const { data } = await getAdminSupabaseClient()
    .from("restaurants")
    .select("metadata")
    .eq("id", KIARA_RESTAURANT_ID)
    .maybeSingle();
  const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
  return { meta, map: (meta.templateHeaderImages as Record<string, string>) ?? {} };
}

export async function rememberTemplateHeaderImage(
  name: string,
  language: string,
  storagePath: string,
): Promise<void> {
  const { meta, map } = await readMap();
  await getAdminSupabaseClient()
    .from("restaurants")
    .update({
      metadata: { ...meta, templateHeaderImages: { ...map, [keyOf(name, language)]: storagePath } },
    })
    .eq("id", KIARA_RESTAURANT_ID);
}

/** A freshly signed URL for the template's own image, or null if none is on file. */
export async function storedTemplateHeaderImage(
  name: string,
  language: string,
): Promise<string | null> {
  const { map } = await readMap();
  const path = map[keyOf(name, language)];
  if (!path) return null;
  const { data } = await getAdminSupabaseClient()
    .storage.from(WHATSAPP_MEDIA_BUCKET)
    .createSignedUrl(path, SEND_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}
