import { createContext, type PropsWithChildren, use } from "react";

import {
  type ColorSchemeName,
  elevation,
  type Palette,
  palettes,
} from "@/constants/theme";

type ThemeContextValue = {
  /** Kiara is intentionally light-only on every device. */
  scheme: ColorSchemeName;
  colors: Palette;
  shadow: ReturnType<typeof elevation>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const lightTheme: ThemeContextValue = {
  scheme: "light",
  colors: palettes.light,
  shadow: elevation("light"),
};

export function ThemeProvider({ children }: PropsWithChildren) {
  return <ThemeContext.Provider value={lightTheme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = use(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
