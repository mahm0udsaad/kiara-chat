import { requireOptionalNativeModule } from "expo";
import { Share } from "react-native";

/**
 * Copy text, on every 1.1.0 install.
 *
 * `expo-clipboard` is native and arrived in build 33 / versionCode 20, but OTA
 * updates reach every 1.1.0 binary — and importing the package on an older one
 * throws at module load, taking the whole conversation screen down with it.
 * So it is only required once the native module is known to be there; older
 * builds get the share sheet, whose own "Copy" does the same job.
 */
const hasNativeClipboard = requireOptionalNativeModule("ExpoClipboard") != null;

export async function copyText(text: string): Promise<void> {
  if (hasNativeClipboard) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
    await Clipboard.setStringAsync(text);
    return;
  }
  await Share.share({ message: text });
}
