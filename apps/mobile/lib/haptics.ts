import * as Haptics from "expo-haptics";

/**
 * Haptics are an iOS-first delight; Android's generic vibration on these APIs
 * feels wrong, so every helper is a no-op off iOS. Failures are swallowed —
 * a device without a Taptic Engine must never break an interaction.
 */
const enabled = process.env.EXPO_OS === "ios";

function run(effect: () => Promise<void>) {
  if (!enabled) return;
  void effect().catch(() => {});
}

/** A tap on a chip, filter, or segment. */
export const tapFeedback = () =>
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** A committed action — sending, saving, taking a conversation. */
export const commitFeedback = () =>
  run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

export const successFeedback = () =>
  run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

export const errorFeedback = () =>
  run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));

export const warningFeedback = () =>
  run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
