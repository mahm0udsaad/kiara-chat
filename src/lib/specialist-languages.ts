import { nationalityOf } from "@/lib/nationalities";

export const SPECIALIST_LANGUAGE_CODES = ["ar", "en", "id", "fil", "ru", "am"] as const;

export type SpecialistLanguageCode = (typeof SPECIALIST_LANGUAGE_CODES)[number];

export interface SpecialistLanguage {
  code: SpecialistLanguageCode;
  /** Arabic label for the roster manager. */
  label: string;
  /** Name shown in the language itself. */
  autonym: string;
  /** Translation target; null means the source dispatch copy is already Arabic. */
  targetLanguage: string | null;
}

export const SPECIALIST_LANGUAGES: SpecialistLanguage[] = [
  { code: "ar", label: "العربية", autonym: "العربية", targetLanguage: null },
  { code: "en", label: "الإنجليزية", autonym: "English", targetLanguage: "English" },
  { code: "id", label: "الإندونيسية", autonym: "Bahasa Indonesia", targetLanguage: "Indonesian" },
  { code: "fil", label: "الفلبينية", autonym: "Filipino", targetLanguage: "Filipino (Tagalog)" },
  { code: "ru", label: "الروسية", autonym: "Русский", targetLanguage: "Russian" },
  { code: "am", label: "الأمهرية", autonym: "አማርኛ", targetLanguage: "Amharic" },
];

/**
 * Rollout-safe overrides for specialists whose stored row cannot yet carry a
 * newly introduced language code. The database migration persists the same
 * choice; keeping this keyed by immutable UUID prevents a deploy-order gap.
 */
const LANGUAGE_BY_SPECIALIST_ID: Partial<Record<string, SpecialistLanguageCode>> = {
  "44600482-2d4b-4026-bc33-c6730de7a8b0": "en", // Gigi
};

const LANGUAGE_BY_NATIONALITY: Record<string, SpecialistLanguageCode> = {
  sa: "ar",
  eg: "ar",
  ma: "ar",
  tn: "ar",
  sy: "ar",
  id: "id",
  ph: "fil",
  ru: "ru",
  et: "am",
};

export function isSpecialistLanguageCode(value: string): value is SpecialistLanguageCode {
  return SPECIALIST_LANGUAGE_CODES.includes(value as SpecialistLanguageCode);
}

export function specialistLanguageOf(
  nationality: string | null | undefined,
  preferredLanguage: string | null | undefined,
  specialistId?: string | null,
): SpecialistLanguage {
  const preferred = preferredLanguage && isSpecialistLanguageCode(preferredLanguage)
    ? preferredLanguage
    : null;
  const specialistOverride = specialistId
    ? LANGUAGE_BY_SPECIALIST_ID[specialistId] ?? null
    : null;
  const nationalityCode = nationality ? LANGUAGE_BY_NATIONALITY[nationality] : null;
  const code = preferred ?? specialistOverride ?? nationalityCode ?? "ar";
  return SPECIALIST_LANGUAGES.find((language) => language.code === code) ?? SPECIALIST_LANGUAGES[0];
}

/**
 * Existing nationalities outside the translated app set can still translate
 * dispatch instructions through the broader nationality catalogue.
 */
export function specialistDispatchLanguageOf(
  nationality: string | null | undefined,
  preferredLanguage: string | null | undefined,
  specialistId?: string | null,
): { label: string; targetLanguage: string | null } {
  if (
    (preferredLanguage && isSpecialistLanguageCode(preferredLanguage)) ||
    (specialistId && LANGUAGE_BY_SPECIALIST_ID[specialistId])
  ) {
    const language = specialistLanguageOf(nationality, preferredLanguage, specialistId);
    return { label: language.label, targetLanguage: language.targetLanguage };
  }
  const nationalityLanguage = nationalityOf(nationality);
  return {
    label: nationalityLanguage?.languageLabel ?? "العربية",
    targetLanguage: nationalityLanguage?.targetLanguage ?? null,
  };
}
