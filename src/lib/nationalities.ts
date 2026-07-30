/**
 * Specialist nationalities and the mother language each one implies. The code
 * is what's stored in specialists.nationality; the language name (in English)
 * feeds the translation prompt. `targetLanguage: null` means Arabic — the
 * order message is already Arabic, so no translation happens.
 */
export interface NationalityOption {
  code: string;
  /** Arabic label shown in pickers (feminine — الأخصائية). */
  label: string;
  /** Arabic name of the mother language, for UI hints. */
  languageLabel: string;
  /** English language name for the translation prompt; null → Arabic, skip. */
  targetLanguage: string | null;
}

export const NATIONALITIES: NationalityOption[] = [
  { code: "sa", label: "سعودية", languageLabel: "العربية", targetLanguage: null },
  { code: "eg", label: "مصرية", languageLabel: "العربية", targetLanguage: null },
  { code: "ma", label: "مغربية", languageLabel: "العربية", targetLanguage: null },
  { code: "tn", label: "تونسية", languageLabel: "العربية", targetLanguage: null },
  { code: "sy", label: "سورية", languageLabel: "العربية", targetLanguage: null },
  { code: "ru", label: "روسية", languageLabel: "الروسية", targetLanguage: "Russian" },
  { code: "ph", label: "فلبينية", languageLabel: "الفلبينية", targetLanguage: "Filipino (Tagalog)" },
  { code: "id", label: "إندونيسية", languageLabel: "الإندونيسية", targetLanguage: "Indonesian" },
  { code: "th", label: "تايلندية", languageLabel: "التايلندية", targetLanguage: "Thai" },
  { code: "vn", label: "فيتنامية", languageLabel: "الفيتنامية", targetLanguage: "Vietnamese" },
  { code: "in", label: "هندية", languageLabel: "الهندية", targetLanguage: "Hindi" },
  { code: "pk", label: "باكستانية", languageLabel: "الأردية", targetLanguage: "Urdu" },
  { code: "np", label: "نيبالية", languageLabel: "النيبالية", targetLanguage: "Nepali" },
  { code: "lk", label: "سريلانكية", languageLabel: "السنهالية", targetLanguage: "Sinhala" },
  { code: "et", label: "إثيوبية", languageLabel: "الأمهرية", targetLanguage: "Amharic" },
  { code: "ke", label: "كينية", languageLabel: "السواحلية", targetLanguage: "Swahili" },
  { code: "ug", label: "أوغندية", languageLabel: "الإنجليزية", targetLanguage: "English" },
];

export function nationalityOf(
  code: string | null | undefined
): NationalityOption | null {
  if (!code) return null;
  return NATIONALITIES.find((n) => n.code === code) ?? null;
}

export function isNationalityCode(code: string): boolean {
  return NATIONALITIES.some((n) => n.code === code);
}
