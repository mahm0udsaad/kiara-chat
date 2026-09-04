import { nationalityOf } from "@/lib/nationalities";

export const SPECIALIST_LANGUAGE_CODES = ["ar", "id", "fil", "ru", "am"] as const;

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
  { code: "id", label: "الإندونيسية", autonym: "Bahasa Indonesia", targetLanguage: "Indonesian" },
  { code: "fil", label: "الفلبينية", autonym: "Filipino", targetLanguage: "Filipino (Tagalog)" },
  { code: "ru", label: "الروسية", autonym: "Русский", targetLanguage: "Russian" },
  { code: "am", label: "الأمهرية", autonym: "አማርኛ", targetLanguage: "Amharic" },
];

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
): SpecialistLanguage {
  const preferred = preferredLanguage && isSpecialistLanguageCode(preferredLanguage)
    ? preferredLanguage
    : null;
  const nationalityCode = nationality ? LANGUAGE_BY_NATIONALITY[nationality] : null;
  const code = preferred ?? nationalityCode ?? "ar";
  return SPECIALIST_LANGUAGES.find((language) => language.code === code) ?? SPECIALIST_LANGUAGES[0];
}

/**
 * Existing nationalities outside the translated app set can still translate
 * dispatch instructions through the broader nationality catalogue.
 */
export function specialistDispatchLanguageOf(
  nationality: string | null | undefined,
  preferredLanguage: string | null | undefined,
): { label: string; targetLanguage: string | null } {
  if (preferredLanguage && isSpecialistLanguageCode(preferredLanguage)) {
    const language = specialistLanguageOf(nationality, preferredLanguage);
    return { label: language.label, targetLanguage: language.targetLanguage };
  }
  const nationalityLanguage = nationalityOf(nationality);
  return {
    label: nationalityLanguage?.languageLabel ?? "العربية",
    targetLanguage: nationalityLanguage?.targetLanguage ?? null,
  };
}
