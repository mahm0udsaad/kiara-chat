import "server-only";

import {
  specialistLanguageOf,
  type SpecialistLanguageCode,
} from "@/lib/specialist-languages";

/**
 * Localised copy for the two field alerts a specialist can receive after an
 * order is already hers — an edit and a cancellation.
 *
 * The specialist reads exactly one of the supported app locales (her
 * `preferred_language`, constrained to that set), so unlike the free-text
 * dispatch note — translated live by the model — these short, fixed operational
 * strings are kept as static dictionaries, the same way the mobile app
 * localises its own UI. Instant, deterministic, and never a model call on the
 * path that wakes her phone. Drivers are always addressed in Arabic and do not
 * go through here.
 */

const TZ = "Asia/Riyadh"; // Kiara operates in KSA; format arrival stably here.

const LOCALE_TAGS: Record<SpecialistLanguageCode, string> = {
  ar: "ar-SA-u-ca-gregory",
  en: "en-SA",
  id: "id-ID",
  fil: "fil-PH",
  ru: "ru-RU",
  am: "am-ET",
};

/** How the client is named when the order carries no customer name. */
const CLIENT_FALLBACK: Record<SpecialistLanguageCode, string> = {
  ar: "العميلة",
  en: "your customer",
  id: "klien Anda",
  fil: "iyong kliyente",
  ru: "вашей клиентки",
  am: "ደንበኛዎ",
};

const UPDATED_PUSH_TITLE: Record<SpecialistLanguageCode, string> = {
  ar: "تعديل في موعدكِ",
  en: "Your appointment changed",
  id: "Perubahan pada janji Anda",
  fil: "Pagbabago sa iyong appointment",
  ru: "Изменение в вашей записи",
  am: "በቀጠሮዎ ላይ ለውጥ",
};

/** `{name}` is interpolated with the customer's name (or the fallback). */
const UPDATED_PUSH_BODY: Record<SpecialistLanguageCode, string> = {
  ar: "تم تعديل تفاصيل موعدكِ مع {name}. يرجى المراجعة.",
  en: "Your appointment details with {name} were updated. Please review them.",
  id: "Detail janji Anda dengan {name} telah diperbarui. Mohon diperiksa.",
  fil: "Na-update ang mga detalye ng iyong appointment kay {name}. Pakisuri.",
  ru: "Детали вашей записи с {name} обновлены. Пожалуйста, проверьте.",
  am: "ከ{name} ጋር ያለዎት የቀጠሮ ዝርዝሮች ተሻሽለዋል። እባክዎ ይመልከቱ።",
};

/** `{name}` and `{arrival}` are interpolated. */
const UPDATED_WHATSAPP: Record<SpecialistLanguageCode, string> = {
  ar: "🌸 *تحديث في الموعد*\n\nتم تعديل تفاصيل موعدكِ مع {name}.\n🕒 موعد الوصول: {arrival}",
  en: "🌸 *Appointment Update*\n\nYour appointment details with {name} were updated.\n🕒 Arrival time: {arrival}",
  id: "🌸 *Pembaruan Janji*\n\nDetail janji Anda dengan {name} telah diperbarui.\n🕒 Waktu kedatangan: {arrival}",
  fil: "🌸 *Update sa Appointment*\n\nNa-update ang mga detalye ng iyong appointment kay {name}.\n🕒 Oras ng pagdating: {arrival}",
  ru: "🌸 *Обновление записи*\n\nДетали вашей записи с {name} обновлены.\n🕒 Время прибытия: {arrival}",
  am: "🌸 *የቀጠሮ ዝማኔ*\n\nከ{name} ጋር ያለዎት የቀጠሮ ዝርዝሮች ተሻሽለዋል።\n🕒 የመድረሻ ሰዓት: {arrival}",
};

const CANCELLED_PUSH_TITLE: Record<SpecialistLanguageCode, string> = {
  ar: "إلغاء الموعد",
  en: "Appointment cancelled",
  id: "Janji dibatalkan",
  fil: "Kanselado ang appointment",
  ru: "Запись отменена",
  am: "ቀጠሮ ተሰርዟል",
};

const CANCELLED_PUSH_BODY: Record<SpecialistLanguageCode, string> = {
  ar: "تم إلغاء موعدكِ مع {name}.",
  en: "Your appointment with {name} was cancelled.",
  id: "Janji Anda dengan {name} telah dibatalkan.",
  fil: "Kinansela ang iyong appointment kay {name}.",
  ru: "Ваша запись с {name} отменена.",
  am: "ከ{name} ጋር ያለዎት ቀጠሮ ተሰርዟል።",
};

const CANCELLED_WHATSAPP: Record<SpecialistLanguageCode, string> = {
  ar: "❌ *إلغاء موعد*\n\nتم إلغاء الموعد المخصص لكِ لـ {name}.",
  en: "❌ *Appointment Cancelled*\n\nYour assigned appointment with {name} was cancelled.",
  id: "❌ *Pembatalan Janji*\n\nJanji yang ditugaskan kepada Anda dengan {name} telah dibatalkan.",
  fil: "❌ *Pagkansela ng Appointment*\n\nKinansela ang appointment na nakatalaga sa iyo kay {name}.",
  ru: "❌ *Отмена записи*\n\nЗапись, назначенная вам с {name}, отменена.",
  am: "❌ *የቀጠሮ ስረዛ*\n\nለእርስዎ የተመደበው ከ{name} ጋር ያለ ቀጠሮ ተሰርዟል።",
};

type Localised = Record<SpecialistLanguageCode, string>;

const ASSIGNED_PUSH_TITLE: Localised = {
  ar: "طلب جديد لكِ",
  en: "New order for you",
  id: "Pesanan baru untuk Anda",
  fil: "May bagong order para sa iyo",
  ru: "Новый заказ для вас",
  am: "አዲስ ትዕዛዝ ለእርስዎ",
};

const ASSIGNED_REPEAT_PUSH_TITLE: Localised = {
  ar: "تذكير بطلبكِ",
  en: "Reminder about your order",
  id: "Pengingat pesanan Anda",
  fil: "Paalala tungkol sa iyong order",
  ru: "Напоминание о вашем заказе",
  am: "ስለ ትዕዛዝዎ ማስታወሻ",
};

const ASSIGNED_PUSH_BODY: Localised = {
  ar: "افتحي تفاصيل طلب {name} وتابعي خطوات التنفيذ.",
  en: "Open {name}'s order details and follow the steps.",
  id: "Buka detail pesanan {name} dan ikuti langkah-langkahnya.",
  fil: "Buksan ang detalye ng order ni {name} at sundin ang mga hakbang.",
  ru: "Откройте детали заказа {name} и следуйте шагам.",
  am: "የ{name}ን ትዕዛዝ ዝርዝር ይክፈቱና ደረጃዎቹን ይከተሉ።",
};

const DRIVER_ARRIVED_PUSH_TITLE: Localised = {
  ar: "وصل السائق",
  en: "Your driver has arrived",
  id: "Pengemudi telah tiba",
  fil: "Dumating na ang driver",
  ru: "Водитель приехал",
  am: "ሹፌሩ ደርሷል",
};

const DRIVER_ARRIVED_PUSH_BODY: Localised = {
  ar: "السائق في انتظاركِ للتوجه إلى {name}.",
  en: "The driver is waiting to take you to {name}.",
  id: "Pengemudi menunggu untuk mengantar Anda ke {name}.",
  fil: "Naghihintay ang driver para ihatid ka kay {name}.",
  ru: "Водитель ждёт, чтобы отвезти вас к {name}.",
  am: "ሹፌሩ ወደ {name} ሊወስድዎ እየጠበቀዎት ነው።",
};

/**
 * Filipino and Russian inflect around the noun, so a bare "your customer"
 * dropped into the named-customer sentence reads wrongly ("kay iyong kliyente",
 * "к вашей клиентки"). These are the wordings for an order with no customer
 * name; other languages read fine through the ordinary template.
 */
const ANONYMOUS_BODY_OVERRIDES: Partial<
  Record<"assigned" | "driverArrived", Partial<Localised>>
> = {
  assigned: {
    fil: "Buksan ang detalye ng order ng iyong kliyente at sundin ang mga hakbang.",
  },
  driverArrived: {
    fil: "Naghihintay ang driver para ihatid ka sa iyong kliyente.",
    ru: "Водитель ждёт, чтобы отвезти вас к клиентке.",
  },
};

const NEXT_STEP_PUSH_TITLE: Localised = {
  ar: "الخطوة التالية جاهزة",
  en: "Your next step is ready",
  id: "Langkah berikutnya siap",
  fil: "Handa na ang susunod mong hakbang",
  ru: "Следующий шаг готов",
  am: "ቀጣዩ ደረጃ ዝግጁ ነው",
};

/** The steps a specialist performs, worded like the buttons in her app. */
export type SpecialistStepAction = "confirm_pickup" | "start_service" | "complete_order";

const STEP_LABEL: Record<SpecialistStepAction, Localised> = {
  confirm_pickup: {
    ar: "ركبتُ مع السائق",
    en: "I am with the driver",
    id: "Saya sudah bersama pengemudi",
    fil: "Nakasakay na ako",
    ru: "Я в машине с водителем",
    am: "ከሹፌሩ ጋር ተሳፍሬያለሁ",
  },
  start_service: {
    ar: "بدء الخدمة عند العميلة",
    en: "Start service",
    id: "Mulai layanan",
    fil: "Simulan ang serbisyo",
    ru: "Начать услугу",
    am: "አገልግሎት ጀምር",
  },
  complete_order: {
    ar: "إنهاء الخدمة والمغادرة",
    en: "Complete service and leave",
    id: "Selesaikan layanan dan pergi",
    fil: "Tapusin ang serbisyo at umalis",
    ru: "Завершить услугу и уехать",
    am: "አገልግሎቱን ጨርሰው ይውጡ",
  },
};

const TEST_PUSH_TITLE: Localised = {
  ar: "اختبار إشعارات كيارا",
  en: "Kiara notification test",
  id: "Uji notifikasi Kiara",
  fil: "Pagsubok ng notification ng Kiara",
  ru: "Проверка уведомлений Kiara",
  am: "የኪያራ ማሳወቂያ ሙከራ",
};

const TEST_PUSH_BODY: Localised = {
  ar: "الإشعارات تعمل على هذا الجهاز.",
  en: "Notifications work on this device.",
  id: "Notifikasi berfungsi di perangkat ini.",
  fil: "Gumagana ang mga notification sa device na ito.",
  ru: "Уведомления работают на этом устройстве.",
  am: "ማሳወቂያዎች በዚህ መሣሪያ ላይ ይሠራሉ።",
};

function interpolate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => variables[key] ?? `{${key}}`);
}

function resolveCode(input: {
  specialistId?: string | null;
  nationality: string | null | undefined;
  preferredLanguage: string | null | undefined;
}): SpecialistLanguageCode {
  return specialistLanguageOf(
    input.nationality,
    input.preferredLanguage,
    input.specialistId,
  ).code;
}

function clientName(
  code: SpecialistLanguageCode,
  customerName: string | null | undefined,
): string {
  return customerName?.trim() || CLIENT_FALLBACK[code];
}

export interface SpecialistFieldCopy {
  code: SpecialistLanguageCode;
  pushTitle: string;
  pushBody: string;
  whatsappBody: string;
}

export function specialistOrderUpdatedCopy(input: {
  specialistId?: string | null;
  nationality: string | null | undefined;
  preferredLanguage: string | null | undefined;
  customerName: string | null | undefined;
  arrivalAt: string;
}): SpecialistFieldCopy {
  const code = resolveCode(input);
  const name = clientName(code, input.customerName);
  const arrival = new Intl.DateTimeFormat(LOCALE_TAGS[code], {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(new Date(input.arrivalAt));
  return {
    code,
    pushTitle: UPDATED_PUSH_TITLE[code],
    pushBody: interpolate(UPDATED_PUSH_BODY[code], { name }),
    whatsappBody: interpolate(UPDATED_WHATSAPP[code], { name, arrival }),
  };
}

export function specialistOrderCancelledCopy(input: {
  specialistId?: string | null;
  nationality: string | null | undefined;
  preferredLanguage: string | null | undefined;
  customerName: string | null | undefined;
}): SpecialistFieldCopy {
  const code = resolveCode(input);
  const name = clientName(code, input.customerName);
  return {
    code,
    pushTitle: CANCELLED_PUSH_TITLE[code],
    pushBody: interpolate(CANCELLED_PUSH_BODY[code], { name }),
    whatsappBody: interpolate(CANCELLED_WHATSAPP[code], { name }),
  };
}

export interface SpecialistPushCopy {
  title: string;
  body: string;
}

interface SpecialistIdentity {
  specialistId?: string | null;
  nationality: string | null | undefined;
  preferredLanguage: string | null | undefined;
}

export function specialistOrderAssignedCopy(
  input: SpecialistIdentity & { customerName: string | null | undefined; repeat?: boolean },
): SpecialistPushCopy {
  const code = resolveCode(input);
  return {
    title: (input.repeat ? ASSIGNED_REPEAT_PUSH_TITLE : ASSIGNED_PUSH_TITLE)[code],
    body: input.customerName?.trim()
      ? interpolate(ASSIGNED_PUSH_BODY[code], { name: input.customerName.trim() })
      : ANONYMOUS_BODY_OVERRIDES.assigned?.[code] ??
        interpolate(ASSIGNED_PUSH_BODY[code], { name: clientName(code, null) }),
  };
}

export function specialistDriverArrivedCopy(
  input: SpecialistIdentity & { customerName: string | null | undefined },
): SpecialistPushCopy {
  const code = resolveCode(input);
  return {
    title: DRIVER_ARRIVED_PUSH_TITLE[code],
    body: input.customerName?.trim()
      ? interpolate(DRIVER_ARRIVED_PUSH_BODY[code], { name: input.customerName.trim() })
      : ANONYMOUS_BODY_OVERRIDES.driverArrived?.[code] ??
        interpolate(DRIVER_ARRIVED_PUSH_BODY[code], { name: clientName(code, null) }),
  };
}

/** Null when the pending step is not one a specialist performs. */
export function specialistNextStepCopy(
  input: SpecialistIdentity & { action: string | null },
): SpecialistPushCopy | null {
  if (!input.action || !(input.action in STEP_LABEL)) return null;
  const code = resolveCode(input);
  return {
    title: NEXT_STEP_PUSH_TITLE[code],
    body: STEP_LABEL[input.action as SpecialistStepAction][code],
  };
}

export function specialistPushTestCopy(input: SpecialistIdentity): SpecialistPushCopy {
  const code = resolveCode(input);
  return { title: TEST_PUSH_TITLE[code], body: TEST_PUSH_BODY[code] };
}
