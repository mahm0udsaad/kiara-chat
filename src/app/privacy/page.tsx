import type { Metadata } from "next";

import { PublicPage, PublicSection } from "@/components/public-page";

export const metadata: Metadata = { title: "سياسة الخصوصية | Kiara Operations" };

export default function PrivacyPage() {
  return (
    <PublicPage title="سياسة الخصوصية" updatedAt="21 أكتوبر 2026">
      <p>
        تطبيق Kiara Operations أداة داخلية يستخدمها موظفو كيارا (خدمة العملاء والسائقون
        والأخصائيات) لإدارة محادثات العميلات وطلباتهن وزيارات الخدمة المنزلية. لا نبيع
        البيانات الشخصية، ولا نستخدمها للإعلانات، ولا نتتبع المستخدمين عبر تطبيقات أو
        مواقع أخرى.
      </p>
      <PublicSection title="البيانات التي نعالجها">
        <ul className="list-disc space-y-2 pe-6">
          <li>بيانات حساب الموظف: الاسم والبريد الإلكتروني أو رقم الجوال ومعرّف الحساب.</li>
          <li>بيانات العميلات: الاسم ورقم الجوال والعنوان أو موقع الزيارة وتفاصيل الحجز.</li>
          <li>
            محتوى المحادثات: الرسائل والصور والملفات والملاحظات الصوتية التي تُرسل أو تُستلم
            عبر واتساب للأعمال.
          </li>
          <li>
            الموقع الدقيق: للسائقين والأخصائيات فقط، عند تنفيذ خطوات الزيارة، وللسائقين أثناء
            رحلة نشطة (كل 20 ثانية تقريباً أثناء فتح شاشة الطلب) ليتمكن فريق خدمة العملاء من
            متابعة وصولهم. لا يُجمع الموقع في الخلفية على iPhone ولا خارج الرحلة النشطة.
          </li>
          <li>
            الميكروفون والكاميرا والصور: لتسجيل ملاحظة صوتية، أو إجراء مكالمة صوتية مع عميلة
            عبر واتساب، أو التقاط صورة أو اختيارها لإرسالها في المحادثة. لا يصل التطبيق إلى هذه
            الأجهزة إلا بإذنك.
          </li>
          <li>رمز إشعارات الجهاز لإرسال تنبيهات الطلبات والرسائل الجديدة.</li>
          <li>
            معلومات تشخيصية: أعطال التطبيق وبطء الطلبات وإصدار التطبيق ونوع الجهاز، لتحسين
            الاستقرار والأمان.
          </li>
        </ul>
      </PublicSection>
      <PublicSection title="لماذا نستخدم البيانات">
        <p>
          نستخدمها حصراً لتشغيل الخدمة: خدمة العملاء، وتنسيق السائقين والأخصائيات، وإرسال
          تنبيهات الطلبات، وتوثيق الزيارات، وحماية الحسابات، وتحسين موثوقية التطبيق. ترتبط
          هذه البيانات بهوية الموظف أو العميلة لأغراض التشغيل فقط، ولا تُستخدم للتتبع أو
          الإعلانات.
        </p>
      </PublicSection>
      <PublicSection title="الخدمات المساندة">
        <p>
          قد تمر البيانات عبر مزودي البنية التشغيلية الذين تعتمد عليهم كيارا، مثل Supabase
          للاستضافة والمصادقة وتخزين الملفات، وExpo لإيصال الإشعارات، وواتساب للأعمال
          (Meta)، ونظام ركاز للحجوزات. نشارك فقط ما يلزم لتشغيل الخدمة.
        </p>
      </PublicSection>
      <PublicSection title="الاحتفاظ والحماية">
        <p>
          تُنقل البيانات عبر اتصال مشفّر، ويقتصر الوصول إليها على الموظفين المخولين بحسب
          صلاحياتهم. تحتفظ كيارا بالبيانات للمدة اللازمة للتشغيل والالتزامات النظامية، ثم
          تُحذف أو تُجهّل.
        </p>
      </PublicSection>
      <PublicSection title="حقوقك وطلب الحذف">
        <p>
          يمكنك طلب الوصول إلى بياناتك أو تصحيحها أو حذفها، بما في ذلك حذف حساب الموظف، عبر
          التواصل مع إدارة كيارا أو مسؤول التطبيق. تُنشأ الحسابات من قبل الإدارة فقط ولا
          يوجد تسجيل عام. وللعميلات اللواتي يرغبن بحذف بياناتهن، يمكنهن التواصل مع كيارا عبر
          واتساب بنفس الرقم الذي يراسلنه.
        </p>
      </PublicSection>
      <PublicSection title="الأطفال">
        <p>التطبيق مخصص للموظفين البالغين ولا يستهدف الأطفال.</p>
      </PublicSection>
      <PublicSection title="تحديث هذه السياسة">
        <p>قد نحدّث هذه السياسة عند تغيّر ممارسات البيانات، وسيظهر تاريخ آخر تحديث أعلاها.</p>
      </PublicSection>
      <section dir="ltr" lang="en" className="border-t border-black/5 pt-7 text-left">
        <h2 className="mb-2 text-xl font-bold text-[#171a2b]">Privacy Policy (English summary)</h2>
        <div className="space-y-3">
          <p>
            Kiara Operations is an internal staff app used by Kiara employees (customer
            service, drivers and beauty specialists) to manage customer chats, bookings and
            home-service visits. We do not sell personal data, do not use it for advertising,
            and do not track users across other apps or websites.
          </p>
          <p>
            <strong>Data processed:</strong> staff account details (name, email or phone,
            user ID); customer name, phone number, address/visit location and booking
            details; chat content (messages, photos, files, voice notes) sent via WhatsApp
            Business; precise location for drivers and specialists only, when a visit step
            is tapped and, for drivers, about every 20 seconds while the order screen is
            open during an active trip (no background location on iOS); microphone, camera
            and photos only with your permission, for voice notes, voice calls and photos in
            chats; a device push token for notifications; and crash and performance
            diagnostics.
          </p>
          <p>
            <strong>Use:</strong> solely to operate the service (customer support, dispatch,
            notifications, visit documentation, account security and reliability). Data is
            linked to staff or customer identity for operations only, never for tracking or
            advertising.
          </p>
          <p>
            <strong>Service providers:</strong> Supabase (hosting, authentication, storage),
            Expo (push notifications), WhatsApp Business (Meta) and the Rekaz booking system.
          </p>
          <p>
            <strong>Retention and deletion:</strong> data is kept only as long as needed for
            operations and legal obligations. Staff accounts are created by Kiara management
            (no public sign-up). To request access, correction or deletion of your data or
            staff account, contact Kiara management or the app administrator. Customers can
            message Kiara on WhatsApp from the same number to request deletion.
          </p>
          <p>
            <strong>Children:</strong> the app is for adult staff and is not directed at
            children.
          </p>
        </div>
      </section>
    </PublicPage>
  );
}
