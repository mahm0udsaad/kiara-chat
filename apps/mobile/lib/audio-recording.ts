import {
  AudioQuality,
  IOSOutputFormat,
  type RecordingOptions,
} from "expo-audio";

/**
 * Recording settings for a spoken note.
 *
 * `RecordingPresets.HIGH_QUALITY` is 128 kbps stereo at 44.1 kHz — music
 * settings. That is roughly a megabyte a minute, so a four-minute note passed
 * the 4.5 MB body limit Vercel enforces and the upload was dropped in flight,
 * which the app could only report as a failed connection.
 *
 * Mono at 32 kbps is the shape of a voice message (WhatsApp's own are in that
 * range), and it keeps `.m4a`/AAC on both platforms — `LOW_QUALITY` would not,
 * it switches Android to AMR in a `.3gp` container. Speech is unaffected and
 * the same note is now about a quarter of the size.
 */
export const VOICE_NOTE_RECORDING: RecordingOptions = {
  extension: ".m4a",
  sampleRate: 24000,
  numberOfChannels: 1,
  bitRate: 32000,
  android: {
    outputFormat: "mpeg4",
    audioEncoder: "aac",
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 32000,
  },
};
