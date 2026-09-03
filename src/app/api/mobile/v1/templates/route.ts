/**
 * GET /api/mobile/v1/templates — the approved templates the composer can send.
 *
 * Only templates whose content sid is actually configured are listed: an
 * employee offered a template that cannot be sent has been promised something
 * the app will then refuse to do.
 */
import { listSendableTemplates } from "@/lib/templates";
import { authorizeMobileRequest, mobileData } from "@/lib/mobile/http";

export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;

  return mobileData({
    templates: listSendableTemplates().map((t) => ({
      key: t.key,
      label: t.label,
      description: t.description,
      category: t.category,
      body: t.body,
      buttons: t.buttons,
      variables: t.variables.map((v) => ({
        key: v.key,
        label: v.label,
        prefill: v.prefill ?? null,
        maxLength: v.maxLength ?? null,
      })),
    })),
  });
}
