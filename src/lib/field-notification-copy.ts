import "server-only";

import {
  specialistLanguageOf,
  type SpecialistLanguageCode,
} from "@/lib/specialist-languages";

/**
 * Localised copy for the two field alerts a specialist can receive after an
 * order is already hers — an edit and a cancellation.
 *
 * The specialist reads exactly one of the five app locales (her
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
  id: "id-ID",
  fil: "fil-PH",
  ru: "ru-RU",
  am: "am-ET",
};

/** How the client is named when the order carries no customer name. */
const CLIENT_FALLBACK: Record<SpecialistLanguageCode, string> = {
  ar: "العميلة",
  id: "klien Anda",
  fil: "iyong kliyente",
  ru: "вашей клиентки",
  am: "ደንበኛዎ",
};

const UPDATED_PUSH_TITLE: Record<SpecialistLanguageCode, string> = {
  ar: "تعديل في موعدكِ",
  id: "Perubahan pada janji Anda",
  fil: "Pagbabago sa iyong appointment",
  ru: "Изменение в вашей записи",
  am: "በቀጠሮዎ ላይ ለውጥ",
};

/** `{name}` is interpolated with the customer's name (or the fallback). */
const UPDATED_PUSH_BODY: Record<SpecialistLanguageCode, string> = {
  ar: "تم تعديل تفاصيل موعدكِ مع {name}. يرجى المراجعة.",
  id: "Detail janji Anda dengan {name} telah diperbarui. Mohon diperiksa.",
  fil: "Na-update ang mga detalye ng iyong appointment kay {name}. Pakisuri.",
  ru: "Детали вашей записи с {name} обновлены. Пожалуйста, проверьте.",
  am: "ከ{name} ጋር ያለዎት የቀጠሮ ዝርዝሮች ተሻሽለዋል። እባክዎ ይመልከቱ።",
};

/** `{name}` and `{arrival}` are interpolated. */
const UPDATED_WHATSAPP: Record<SpecialistLanguageCode, string> = {
  ar: "🌸 *تحديث في الموعد*\n\nتم تعديل تفاصيل موعدكِ مع {name}.\n🕒 موعد الوصول: {arrival}",
  id: "🌸 *Pembaruan Janji*\n\nDetail janji Anda dengan {name} telah diperbarui.\n🕒 Waktu kedatangan: {arrival}",
  fil: "🌸 *Update sa Appointment*\n\nNa-update ang mga detalye ng iyong appointment kay {name}.\n🕒 Oras ng pagdating: {arrival}",
  ru: "🌸 *Обновление записи*\n\nДетали вашей записи с {name} обновлены.\n🕒 Время прибытия: {arrival}",
  am: "🌸 *የቀጠሮ ዝማኔ*\n\nከ{name} ጋር ያለዎት የቀጠሮ ዝርዝሮች ተሻሽለዋል።\n🕒 የመድረሻ ሰዓት: {arrival}",
};

const CANCELLED_PUSH_TITLE: Record<SpecialistLanguageCode, string> = {
  ar: "إلغاء الموعد",
  id: "Janji dibatalkan",
  fil: "Kanselado ang appointment",
  ru: "Запись отменена",
  am: "ቀጠሮ ተሰርዟል",
};

const CANCELLED_PUSH_BODY: Record<SpecialistLanguageCode, string> = {
  ar: "تم إلغاء موعدكِ مع {name}.",
  id: "Janji Anda dengan {name} telah dibatalkan.",
  fil: "Kinansela ang iyong appointment kay {name}.",
  ru: "Ваша запись с {name} отменена.",
  am: "ከ{name} ጋር ያለዎት ቀጠሮ ተሰርዟል።",
};

const CANCELLED_WHATSAPP: Record<SpecialistLanguageCode, string> = {
  ar: "❌ *إلغاء موعد*\n\nتم إلغاء الموعد المخصص لكِ لـ {name}.",
  id: "❌ *Pembatalan Janji*\n\nJanji yang ditugaskan kepada Anda dengan {name} telah dibatalkan.",
  fil: "❌ *Pagkansela ng Appointment*\n\nKinansela ang appointment na nakatalaga sa iyo kay {name}.",
  ru: "❌ *Отмена записи*\n\nЗапись, назначенная вам с {name}, отменена.",
  am: "❌ *የቀጠሮ ስረዛ*\n\nለእርስዎ የተመደበው ከ{name} ጋር ያለ ቀጠሮ ተሰርዟል።",
};

function interpolate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => variables[key] ?? `{${key}}`);
}

function resolveCode(input: {
  nationality: string | null | undefined;
  preferredLanguage: string | null | undefined;
}): SpecialistLanguageCode {
  return specialistLanguageOf(input.nationality, input.preferredLanguage).code;
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
