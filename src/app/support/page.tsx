import type { Metadata } from "next";

import { PublicPage, PublicSection } from "@/components/public-page";

export const metadata: Metadata = { title: "الدعم الفني | Kiara Operations" };

export default function SupportPage() {
  return (
    <PublicPage title="الدعم الفني" updatedAt="11 أغسطس 2026">
      <p>
        للحصول على المساعدة، تواصل مع مسؤول Kiara Operations أو إدارة كيارا عبر قناة الدعم
        الداخلية المعتمدة لديكم.
      </p>
      <PublicSection title="قبل إرسال البلاغ">
        <p>
          حدّث بيانات الشاشة، وتأكد من اتصال الإنترنت، ثم أغلق التطبيق وافتحه مرة أخرى. لا
          ترسل كلمة المرور أو رموز تسجيل الدخول ضمن البلاغ.
        </p>
      </PublicSection>
      <PublicSection title="ما الذي نحتاجه لمعالجة المشكلة؟">
        <p>
          اذكر نوع جهازك وإصدار النظام، والشاشة أو الطلب المتأثر، ووقت حدوث المشكلة، وصورة
          للخطأ إن أمكن مع إخفاء أي بيانات لا يحتاجها فريق الدعم.
        </p>
      </PublicSection>
      <PublicSection title="الحساب والوصول">
        <p>
          إذا تعذر تسجيل الدخول أو احتجت إلى حذف الحساب الوظيفي، اطلب ذلك من مسؤول التطبيق
          في كيارا. لا يمكن إنشاء حسابات عامة من داخل التطبيق.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
