import {
  isSpecialistLanguageCode,
  SPECIALIST_LANGUAGES,
  specialistLanguageOf,
  type SpecialistLanguageCode,
} from "@/lib/specialist-languages";

/**
 * Static wording for the specialist's order messages, used when live
 * translation is unavailable.
 *
 * The fallback used to be English for every non-Arabic specialist, which reads
 * fine for one who chose English and is a second foreign language for an
 * Indonesian, Filipino, Russian or Amharic speaker. Each app language now has
 * its own copy; nationalities outside that set (Thai, Hindi, …) still fall back
 * to English, the one language they can be expected to work from.
 */
export type SpecialistFallbackCode = Exclude<SpecialistLanguageCode, "ar">;

/**
 * The language to fall back to for a specialist whose dispatch is translated.
 * Only meaningful when the caller already knows a translation target exists.
 */
export function specialistFallbackCodeOf(
  nationality: string | null | undefined,
  preferredLanguage: string | null | undefined,
  specialistId?: string | null,
): SpecialistFallbackCode {
  const code = specialistLanguageOf(nationality, preferredLanguage, specialistId).code;
  // Mirrors specialistDispatchLanguageOf: an explicit app-language choice wins,
  // otherwise a nationality outside the app set yields "ar" here and English.
  return code !== "ar" && isSpecialistLanguageCode(code) ? code : "en";
}

/** Arabic name of the fallback language, for telling the employee what was sent. */
export function specialistFallbackLabel(code: SpecialistFallbackCode): string {
  return SPECIALIST_LANGUAGES.find((language) => language.code === code)?.label ?? "الإنجليزية";
}

interface Copy {
  localeTag: string;
  heading: string;
  arrival: string;
  duration: string;
  driver: string;
  services: string;
  note: string;
  sessionLink: string;
  minute: string;
  hour: string;
  hours: string;
  serviceAdded: string;
  serviceUpdated: string;
  expectedEnd: string;
}

const COPY: Record<SpecialistFallbackCode, Copy> = {
  en: {
    localeTag: "en-SA",
    heading: "🌸 *New appointment for you*",
    arrival: "🕒 Arrival time",
    duration: "⏱️ Session duration",
    driver: "🚕 Driver",
    services: "💅 Services in order:",
    note: "📝 Note from the team",
    sessionLink: "📲 Your visits and start/end confirmation:",
    minute: "min",
    hour: "hour",
    hours: "hours",
    serviceAdded: "Service added",
    serviceUpdated: "Service updated",
    expectedEnd: "Expected end",
  },
  id: {
    localeTag: "id-ID",
    heading: "🌸 *Janji baru untuk Anda*",
    arrival: "🕒 Waktu kedatangan",
    duration: "⏱️ Durasi sesi",
    driver: "🚕 Pengemudi",
    services: "💅 Layanan sesuai urutan:",
    note: "📝 Catatan dari tim",
    sessionLink: "📲 Kunjungan Anda dan konfirmasi mulai/selesai:",
    minute: "menit",
    hour: "jam",
    hours: "jam",
    serviceAdded: "Layanan ditambahkan",
    serviceUpdated: "Layanan diperbarui",
    expectedEnd: "Perkiraan selesai",
  },
  fil: {
    localeTag: "fil-PH",
    heading: "🌸 *Bagong appointment para sa iyo*",
    arrival: "🕒 Oras ng pagdating",
    duration: "⏱️ Tagal ng session",
    driver: "🚕 Driver",
    services: "💅 Mga serbisyo ayon sa pagkakasunod:",
    note: "📝 Tala mula sa team",
    sessionLink: "📲 Ang iyong mga bisita at kumpirmasyon ng simula/tapos:",
    minute: "minuto",
    hour: "oras",
    hours: "oras",
    serviceAdded: "Naidagdag ang serbisyo",
    serviceUpdated: "Na-update ang serbisyo",
    expectedEnd: "Inaasahang tapos",
  },
  ru: {
    localeTag: "ru-RU",
    heading: "🌸 *Новая запись для вас*",
    arrival: "🕒 Время прибытия",
    duration: "⏱️ Длительность сеанса",
    driver: "🚕 Водитель",
    services: "💅 Услуги по порядку:",
    note: "📝 Заметка от команды",
    sessionLink: "📲 Ваши визиты и подтверждение начала/окончания:",
    minute: "мин",
    hour: "ч",
    hours: "ч",
    serviceAdded: "Услуга добавлена",
    serviceUpdated: "Услуга изменена",
    expectedEnd: "Ожидаемое окончание",
  },
  am: {
    localeTag: "am-ET",
    heading: "🌸 *አዲስ ቀጠሮ ለእርስዎ*",
    arrival: "🕒 የመድረሻ ሰዓት",
    duration: "⏱️ የክፍለ ጊዜ ቆይታ",
    driver: "🚕 ሹፌር",
    services: "💅 አገልግሎቶች በቅደም ተከተል:",
    note: "📝 ከቡድኑ የተላከ ማስታወሻ",
    sessionLink: "📲 የእርስዎ ጉብኝቶች እና የመጀመሪያ/መጨረሻ ማረጋገጫ:",
    minute: "ደቂቃ",
    hour: "ሰዓት",
    hours: "ሰዓት",
    serviceAdded: "አገልግሎት ተጨምሯል",
    serviceUpdated: "አገልግሎት ተሻሽሏል",
    expectedEnd: "የሚጠበቀው ማብቂያ",
  },
};

const TZ = "Asia/Riyadh";

function duration(copy: Copy, minutes: number): string {
  if (minutes < 60) return `${minutes} ${copy.minute}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourLabel = `${hours} ${hours === 1 ? copy.hour : copy.hours}`;
  return rest ? `${hourLabel} ${rest} ${copy.minute}` : hourLabel;
}

export function fallbackSpecialistOrderMessage(
  code: SpecialistFallbackCode,
  o: {
    arrivalAt: string;
    durationMinutes: number;
    driverName: string;
    note: string | null;
    services?: { name: string; minutes: number }[];
    sessionLink?: string | null;
  },
): string {
  const copy = COPY[code];
  const arrival = new Intl.DateTimeFormat(copy.localeTag, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  }).format(new Date(o.arrivalAt));
  const lines = [
    copy.heading,
    "",
    `${copy.arrival}: ${arrival}`,
    `${copy.duration}: ${duration(copy, o.durationMinutes)}`,
    `${copy.driver}: ${o.driverName}`,
  ];
  const services = (o.services ?? []).filter((service) => service.name);
  if (services.length) {
    lines.push("", copy.services);
    services.forEach((service, index) => {
      const length = service.minutes > 0 ? ` (${duration(copy, service.minutes)})` : "";
      lines.push(`${index + 1}. ${service.name}${length}`);
    });
  }
  if (o.note) lines.push("", `${copy.note}: ${o.note}`);
  if (o.sessionLink) lines.push("", copy.sessionLink, o.sessionLink);
  return lines.join("\n");
}

export function fallbackServiceChangeMessage(
  code: SpecialistFallbackCode,
  o: { existing: boolean; name: string; minutes: number; customerPhone: string; endsAt: string },
): string {
  const copy = COPY[code];
  const end = new Intl.DateTimeFormat(copy.localeTag, {
    timeZone: TZ,
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(o.endsAt));
  return [
    `${o.existing ? copy.serviceUpdated : copy.serviceAdded}: ${o.name} (${duration(copy, o.minutes)})`,
    o.customerPhone,
    `${copy.expectedEnd}: ${end}`,
  ].join("\n");
}
