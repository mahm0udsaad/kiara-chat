import * as Linking from "expo-linking";

import { Card, Divider } from "@/components/ui/card";
import { DetailRow } from "@/components/ui/detail-row";
import { useFieldI18n } from "@/lib/field-i18n";

const PUBLIC_SITE_URL = (
  process.env.EXPO_PUBLIC_PUBLIC_SITE_URL ??
  process.env.EXPO_PUBLIC_API_URL ??
  "https://sales-ar-seven.vercel.app"
).replace(/\/$/, "");

function openPublicPage(path: string) {
  void Linking.openURL(`${PUBLIC_SITE_URL}${path}`);
}

export function LegalLinks() {
  const { t } = useFieldI18n();
  return (
    <Card padded={false} style={{ paddingHorizontal: 20 }}>
      <DetailRow
        icon="lock"
        label={t("privacy")}
        value={t("privacyPolicy")}
        actionLabel={t("openPrivacy")}
        onPress={() => openPublicPage("/privacy")}
      />
      <Divider inset={46} />
      <DetailRow
        icon="info.circle"
        label={t("terms")}
        value={t("termsOfUse")}
        actionLabel={t("openTerms")}
        onPress={() => openPublicPage("/terms")}
      />
      <Divider inset={46} />
      <DetailRow
        icon="envelope"
        label={t("help")}
        value={t("technicalSupport")}
        actionLabel={t("openSupport")}
        onPress={() => openPublicPage("/support")}
      />
    </Card>
  );
}
