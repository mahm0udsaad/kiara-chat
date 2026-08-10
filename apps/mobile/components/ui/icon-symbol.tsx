import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";

/**
 * One icon vocabulary for the whole app, named by SF Symbol.
 *
 * iOS renders the real SF Symbol through expo-image's `sf:` source; Android
 * falls back to the closest Material icon. Adding an icon means adding it to
 * `androidFallback` too, otherwise Android silently renders a placeholder.
 */
export type IconName =
  | "message"
  | "message.fill"
  | "calendar"
  | "person.crop.circle"
  | "person.2"
  | "car"
  | "sparkles"
  | "clock"
  | "checkmark.circle"
  | "checkmark"
  | "exclamationmark.triangle"
  | "exclamationmark.circle"
  | "mappin.and.ellipse"
  | "phone"
  | "arrow.up"
  | "arrow.up.circle.fill"
  | "arrow.clockwise"
  | "magnifyingglass"
  | "chevron.left"
  | "chevron.right"
  | "pencil"
  | "paperplane.fill"
  | "bell"
  | "moon"
  | "sun.max"
  | "gearshape"
  | "rectangle.portrait.and.arrow.right"
  | "hourglass"
  | "tray"
  | "lock"
  | "envelope"
  | "eye"
  | "eye.slash"
  | "info.circle"
  | "arrow.triangle.2.circlepath"
  | "figure.walk";

const androidFallback: Record<IconName, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  message: "chat-bubble-outline",
  "message.fill": "chat-bubble",
  calendar: "calendar-month",
  "person.crop.circle": "account-circle",
  "person.2": "group",
  car: "directions-car",
  sparkles: "auto-awesome",
  clock: "schedule",
  "checkmark.circle": "check-circle",
  checkmark: "check",
  "exclamationmark.triangle": "warning",
  "exclamationmark.circle": "error-outline",
  "mappin.and.ellipse": "place",
  phone: "call",
  "arrow.up": "arrow-upward",
  "arrow.up.circle.fill": "arrow-circle-up",
  "arrow.clockwise": "refresh",
  magnifyingglass: "search",
  "chevron.left": "chevron-left",
  "chevron.right": "chevron-right",
  pencil: "edit",
  "paperplane.fill": "send",
  bell: "notifications",
  moon: "dark-mode",
  "sun.max": "light-mode",
  gearshape: "settings",
  "rectangle.portrait.and.arrow.right": "logout",
  hourglass: "hourglass-empty",
  tray: "inbox",
  lock: "lock-outline",
  envelope: "mail-outline",
  eye: "visibility",
  "eye.slash": "visibility-off",
  "info.circle": "info-outline",
  "arrow.triangle.2.circlepath": "sync",
  "figure.walk": "directions-walk",
};

type Props = {
  name: IconName;
  color: string;
  size?: number;
};

export function IconSymbol({ name, color, size = 20 }: Props) {
  if (process.env.EXPO_OS === "ios") {
    return (
      <Image
        source={`sf:${name}`}
        tintColor={color}
        style={{ width: size, height: size }}
        // Icons are always paired with a text label or an accessibilityLabel on
        // the pressable that owns them, so they stay out of the a11y tree.
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    );
  }
  return (
    <MaterialIcons
      name={androidFallback[name]}
      size={size}
      color={color}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
