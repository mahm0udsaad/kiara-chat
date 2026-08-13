import type { Metadata } from "next";

import { PublicPage, PublicSection } from "@/components/public-page";

export const metadata: Metadata = { title: "شروط الاستخدام | Kiara Operations" };

export default function TermsPage() {
  return (
    <PublicPage title="شروط الاستخدام" updatedAt="11 أغسطس 2026">
      <p>
        Kiara Operations تطبيق عمل داخلي مخصص للموظفين والسائقين والأخصائيات المخولين من
        كيارا. استخدامك للتطبيق يعني موافقتك على هذه الشروط وسياسات جهة العمل.
      </p>
      <PublicSection title="الاستخدام المسموح">
        <p>
          استخدم التطبيق فقط لتنفيذ مهام كيارا، وحافظ على سرية بيانات العملاء، ولا تشارك
          الحساب أو كلمات المرور أو تفاصيل الطلبات مع غير المخولين.
        </p>
      </PublicSection>
      <PublicSection title="دقة الإجراءات">
        <p>
          راجع الرسائل والتأكيدات قبل إرسالها، وسجل حالة الطلب والتذكير بدقة. يبقى المستخدم
          مسؤولًا عن التحقق من الإجراء النهائي الظاهر له قبل اعتماده.
        </p>
      </PublicSection>
      <PublicSection title="توفر الخدمة">
        <p>
          قد تتوقف بعض الوظائف مؤقتًا للصيانة أو بسبب خدمات خارجية. يجب إبلاغ إدارة كيارا
          فورًا عند ملاحظة خلل يؤثر على العميل أو تنفيذ الطلب.
        </p>
      </PublicSection>
      <PublicSection title="إنهاء الوصول">
        <p>
          يجوز لكيارا تعليق أو إلغاء الوصول عند انتهاء علاقة العمل، أو الاشتباه في إساءة
          الاستخدام، أو الحاجة لحماية العملاء والأنظمة.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
