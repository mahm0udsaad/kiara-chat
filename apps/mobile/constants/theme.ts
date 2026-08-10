import type { TextStyle } from "react-native";

/**
 * Design tokens for the Kiara Operations app.
 *
 * Every value here is a token — screens must never hardcode a colour, radius,
 * or spacing number. Contrast of each text colour against its intended
 * background is documented inline and meets WCAG 2.2 AA (4.5:1 body, 3:1 large).
 */

/** 4pt base grid. */
export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 56,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 28,
  full: 999,
} as const;

/** Minimum interactive size — 44pt (iOS HIG) / 48dp (Material). */
export const hitSize = {
  min: 44,
  comfortable: 48,
  control: 52,
} as const;

/**
 * Type scale mirroring the iOS text styles, with Arabic-friendly line heights
 * (Arabic glyphs sit taller than Latin, so every ramp gets extra leading).
 */
export const type = {
  largeTitle: { fontSize: 34, lineHeight: 44, fontWeight: "800" },
  title1: { fontSize: 28, lineHeight: 38, fontWeight: "800" },
  title2: { fontSize: 22, lineHeight: 31, fontWeight: "800" },
  title3: { fontSize: 20, lineHeight: 28, fontWeight: "700" },
  headline: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  body: { fontSize: 16, lineHeight: 25, fontWeight: "400" },
  bodyStrong: { fontSize: 16, lineHeight: 25, fontWeight: "700" },
  callout: { fontSize: 15, lineHeight: 23, fontWeight: "400" },
  calloutStrong: { fontSize: 15, lineHeight: 23, fontWeight: "700" },
  subhead: { fontSize: 14, lineHeight: 21, fontWeight: "400" },
  subheadStrong: { fontSize: 14, lineHeight: 21, fontWeight: "700" },
  footnote: { fontSize: 13, lineHeight: 19, fontWeight: "400" },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: "600" },
} satisfies Record<string, TextStyle>;

/** Tabular figures — use on any counter, timer, price, or clock. */
export const numeric = { fontVariant: ["tabular-nums"] } satisfies TextStyle;

/** The app is Arabic-first; all copy is right-aligned RTL. */
export const rtlText = {
  textAlign: "right",
  writingDirection: "rtl",
} satisfies TextStyle;

const lightPalette = {
  /** App canvas behind scrollable content. */
  background: "#F4F6FB",
  /** Cards, sheets, headers. */
  surface: "#FFFFFF",
  /** Recessed wells inside a surface (inputs, chat canvas). */
  surfaceSunken: "#EDEFF7",
  /** A surface stacked on top of another surface. */
  surfaceRaised: "#FFFFFF",

  /** 14.9:1 on surface. */
  text: "#141A33",
  /** 5.9:1 on surface — safe for body copy. */
  textSecondary: "#555F82",
  /** 4.6:1 on surface — safe for body copy, reads as quiet. */
  textTertiary: "#6C7695",

  border: "#E2E6F2",
  borderStrong: "#C9D0E4",

  brand: "#2B3FB0",
  brandPressed: "#22318C",
  brandSoft: "#EAEDFB",
  /** 5.6:1 on brandSoft. */
  onBrandSoft: "#25368F",
  onBrand: "#FFFFFF",

  success: "#0E7355",
  successSoft: "#E2F4EE",
  onSuccessSoft: "#0B5F46",

  warning: "#8A5600",
  warningSoft: "#FFF2D8",
  onWarningSoft: "#734800",

  danger: "#BF2F38",
  dangerSoft: "#FDEBED",
  onDangerSoft: "#A5262E",

  info: "#1A6AAE",
  infoSoft: "#E6F1FA",
  onInfoSoft: "#155A93",

  /** Scrims and dividers. */
  overlay: "rgba(15, 20, 45, 0.38)",
  /** Skeleton shimmer base. */
  skeleton: "#E5E9F3",
};

const darkPalette: typeof lightPalette = {
  background: "#0C0F1D",
  surface: "#161B2E",
  surfaceSunken: "#101426",
  surfaceRaised: "#1D2338",

  /** 14.2:1 on surface. */
  text: "#F0F2FA",
  /** 7.3:1 on surface. */
  textSecondary: "#AEB6D2",
  /** 5.1:1 on surface. */
  textTertiary: "#8D96B6",

  border: "#282F49",
  borderStrong: "#3B4364",

  brand: "#8395F5",
  brandPressed: "#6D80E6",
  brandSoft: "#222A4E",
  onBrandSoft: "#AEBBFF",
  /** Dark ink on the light-in-dark brand fill. */
  onBrand: "#0B0E1C",

  success: "#4FD3A5",
  successSoft: "#12332A",
  onSuccessSoft: "#7BE3BF",

  warning: "#F2B950",
  warningSoft: "#372A10",
  onWarningSoft: "#F7CE83",

  danger: "#FF8892",
  dangerSoft: "#3A1A1F",
  onDangerSoft: "#FFAEB5",

  info: "#6FB6F2",
  infoSoft: "#122A3D",
  onInfoSoft: "#9BCFF8",

  overlay: "rgba(0, 0, 0, 0.55)",
  skeleton: "#222941",
};

export type Palette = typeof lightPalette;
export type ColorSchemeName = "light" | "dark";

export const palettes: Record<ColorSchemeName, Palette> = {
  light: lightPalette,
  dark: darkPalette,
};

/**
 * Elevation. Dark surfaces read depth from lightness rather than shadow, so the
 * dark ramp intentionally drops most of the blur.
 */
export function elevation(scheme: ColorSchemeName) {
  if (scheme === "dark") {
    return {
      card: "0 1px 1px rgba(0, 0, 0, 0.4)",
      raised: "0 6px 18px rgba(0, 0, 0, 0.5)",
      overlay: "0 16px 40px rgba(0, 0, 0, 0.6)",
    } as const;
  }
  return {
    card: "0 1px 2px rgba(24, 33, 77, 0.06)",
    raised: "0 6px 18px rgba(24, 33, 77, 0.09)",
    overlay: "0 16px 40px rgba(24, 33, 77, 0.16)",
  } as const;
}

/** Motion durations, in ms. Keep interactions inside 200–500ms. */
export const duration = {
  fast: 160,
  base: 240,
  slow: 360,
} as const;

/**
 * Legacy alias kept so any not-yet-migrated import still resolves. Prefer
 * `useTheme()` — it is the only source that reacts to dark mode.
 */
export const colors = lightPalette;
