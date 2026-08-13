import * as Linking from "expo-linking";

import { Card, Divider } from "@/components/ui/card";
import { DetailRow } from "@/components/ui/detail-row";

const PUBLIC_SITE_URL = (
  process.env.EXPO_PUBLIC_PUBLIC_SITE_URL ??
  process.env.EXPO_PUBLIC_API_URL ??
  "https://sales-ar-seven.vercel.app"
).replace(/\/$/, "");

function openPublicPage(path: string) {
  void Linking.openURL(`${PUBLIC_SITE_URL}${path}`);
}

export function LegalLinks() {
  return (
    <Card padded={false} style={{ paddingHorizontal: 20 }}>
      <DetailRow
        icon="lock"
        label="الخصوصية"
        value="سياسة الخصوصية"
        actionLabel="فتح سياسة الخصوصية"
        onPress={() => openPublicPage("/privacy")}
      />
      <Divider inset={46} />
      <DetailRow
        icon="info.circle"
        label="الشروط"
        value="شروط استخدام التطبيق"
        actionLabel="فتح شروط الاستخدام"
        onPress={() => openPublicPage("/terms")}
      />
      <Divider inset={46} />
      <DetailRow
        icon="envelope"
        label="المساعدة"
        value="الدعم الفني"
        actionLabel="فتح صفحة الدعم الفني"
        onPress={() => openPublicPage("/support")}
      />
    </Card>
  );
}
