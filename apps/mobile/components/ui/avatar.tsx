import { Text, View } from "react-native";

import { radius, type } from "@/constants/theme";
import { avatarHue, initialsOf } from "@/lib/format";

type Props = {
  name: string | null;
  /** Seed for the colour — a phone number keeps one person one colour. */
  seed: string;
  size?: number;
};

/**
 * Initials avatar with a deterministic hue, so an operator learns to recognise
 * a regular customer by colour before reading the name.
 */
export function Avatar({ name, seed, size = 44 }: Props) {
  const hue = avatarHue(seed);
  const background = `hsl(${hue} 68% 92%)`;
  const foreground = `hsl(${hue} 62% 26%)`;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: background,
      }}
    >
      <Text
        style={{
          ...type.calloutStrong,
          fontSize: Math.round(size * 0.36),
          lineHeight: Math.round(size * 0.46),
          color: foreground,
        }}
      >
        {initialsOf(name, seed)}
      </Text>
    </View>
  );
}
