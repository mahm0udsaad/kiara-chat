import { useCallback, useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, type LayoutChangeEvent } from "react-native";

/**
 * Bottom padding that lifts a screen's action bar clear of the soft keyboard,
 * for the Android cases React Native's own `KeyboardAvoidingView` misses.
 *
 * Android gives us two different worlds and the same code has to survive both:
 *
 *  - The release build is edge-to-edge (mandatory since SDK 54), so the window
 *    keeps its full height when the keyboard opens. `adjustResize` in the
 *    manifest never fires, `KeyboardAvoidingView` has nothing to measure, and
 *    the composer sits underneath the keyboard.
 *  - Expo Go — and any non-edge-to-edge host — really does resize the window,
 *    so the composer is already lifted and padding by the keyboard height on
 *    top of that leaves a keyboard-sized band of dead space below the input.
 *
 * So we don't trust either assumption: we watch how much the container itself
 * shrank when the keyboard appeared and pad only the shortfall. When the window
 * resizes, the shortfall is zero and we add nothing; when it doesn't, we add the
 * whole keyboard. Padding lives inside the measured box, so adding it does not
 * change the height `onLayout` reports and there is no feedback loop.
 *
 * Wire it up as:
 *
 *   const keyboard = useKeyboardPadding();
 *   <View onLayout={keyboard.onLayout} style={{ paddingBottom: keyboard.paddingBottom }}>
 *
 * iOS is left alone — `KeyboardAvoidingView` with behavior "padding" already
 * works there — so `paddingBottom` stays 0 and callers keep their iOS path.
 */
export function useKeyboardPadding() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // `resting` is the container's height with no keyboard up; `current` is what
  // it measures right now. Kept together so one layout pass updates both
  // consistently. The ref mirrors the keyboard state for the layout callback,
  // which runs outside render and needs to know which field to write.
  const [heights, setHeights] = useState({ resting: 0, current: 0 });
  const keyboardOpen = useRef(false);
  const layoutDetectedKeyboard = useRef(false);
  const restingHeight = useRef(0);

  /** Ignore ordinary header/safe-area measurements; keyboards are much taller. */
  const KEYBOARD_LAYOUT_DELTA = 80;

  useEffect(() => {
    if (process.env.EXPO_OS === "ios") return;

    // Android only emits the "did" pair; there is no will-show event to use.
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      keyboardOpen.current = true;
      layoutDetectedKeyboard.current = false;
      const coordinates = event.endCoordinates;
      // Several OEM keyboards report only the key panel in `height`, excluding
      // their suggestion/action row or the system navigation strip. `screenY`
      // gives the real top edge of everything obscuring our window, so use the
      // larger measurement. This is the difference between a fully visible
      // composer and the send button peeking out behind Gboard on those phones.
      const coveredFromScreenBottom = coordinates
        ? Math.max(Dimensions.get("screen").height - coordinates.screenY, 0)
        : 0;
      setKeyboardHeight(Math.max(coordinates?.height ?? 0, coveredFromScreenBottom));
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardOpen.current = false;
      layoutDetectedKeyboard.current = false;
      setKeyboardHeight(0);
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    const previousResting = restingHeight.current;

    // Android 10 and earlier may suppress keyboard events when the activity
    // uses adjustResize. The layout still shrinks, however, and that is enough
    // to tell that the keyboard is up. Do not replace the resting measurement
    // with this shorter height or the next render loses the evidence.
    if (!keyboardOpen.current && previousResting > 0 && height < previousResting - KEYBOARD_LAYOUT_DELTA) {
      layoutDetectedKeyboard.current = true;
      setHeights({ resting: previousResting, current: height });
      return;
    }

    if (!keyboardOpen.current && layoutDetectedKeyboard.current) {
      if (height >= previousResting - KEYBOARD_LAYOUT_DELTA) {
        layoutDetectedKeyboard.current = false;
        restingHeight.current = height;
        setHeights({ resting: height, current: height });
      } else {
        setHeights({ resting: previousResting, current: height });
      }
      return;
    }

    if (!keyboardOpen.current) restingHeight.current = height;
    setHeights({ resting: keyboardOpen.current ? previousResting : height, current: height });
  }, []);

  const shrank = Math.max(heights.resting - heights.current, 0);
  const paddingBottom =
    keyboardHeight === 0 ? 0 : Math.max(keyboardHeight - shrank, 0);

  return {
    paddingBottom,
    onLayout,
    keyboardVisible: keyboardHeight > 0 || layoutDetectedKeyboard.current,
  };
}
