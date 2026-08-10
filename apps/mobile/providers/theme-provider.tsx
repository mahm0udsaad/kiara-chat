import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";

import {
  type ColorSchemeName,
  elevation,
  type Palette,
  palettes,
} from "@/constants/theme";

export type AppearancePreference = "system" | "light" | "dark";

const STORAGE_KEY = "kiara.appearance";

type ThemeContextValue = {
  /** The scheme actually being rendered. */
  scheme: ColorSchemeName;
  /** What the user picked — "system" follows the device. */
  preference: AppearancePreference;
  setPreference: (next: AppearancePreference) => void;
  colors: Palette;
  shadow: ReturnType<typeof elevation>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isPreference(value: string | null): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] =
    useState<AppearancePreference>("system");

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(STORAGE_KEY)
      .then((stored) => {
        if (active && isPreference(stored)) setPreferenceState(stored);
      })
      .catch(() => {
        // A missing or unreadable preference just means "follow the system".
      });
    return () => {
      active = false;
    };
  }, []);

  const setPreference = useCallback((next: AppearancePreference) => {
    setPreferenceState(next);
    void SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => {
      // Persisting is best-effort; the in-memory choice still applies.
    });
  }, []);

  const scheme: ColorSchemeName =
    preference === "system" ? (systemScheme === "dark" ? "dark" : "light") : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      scheme,
      preference,
      setPreference,
      colors: palettes[scheme],
      shadow: elevation(scheme),
    }),
    [scheme, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = use(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
