import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { VOICE_NOTE_RECORDING } from "@/lib/audio-recording";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { InlineAlert } from "@/components/screen-state";
import { Card } from "@/components/ui/card";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { tapFeedback, warningFeedback } from "@/lib/haptics";
import { useTheme } from "@/providers/theme-provider";

/** A finished recording, as the dispatch form holds it until send. */
export type VoiceNote = { uri: string; seconds: number };

/**
 * Past this the salon is dictating a phone call, and the upload starts pushing
 * the 8MB the API accepts. Recording stops itself rather than failing at send.
 */
const MAX_SECONDS = 180;

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** Playback of what was just recorded — she hears it before the specialist does. */
function Playback({ note }: { note: VoiceNote }) {
  const { colors } = useTheme();
  const player = useAudioPlayer({ uri: note.uri });
  const status = useAudioPlayerStatus(player);

  // Playback leaves the head at the end; rewinding here means a second tap on
  // play restarts the note instead of doing nothing.
  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
  }, [status.didJustFinish, player]);

  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? "إيقاف الاستماع" : "الاستماع للتسجيل"}
        onPress={() => (status.playing ? player.pause() : player.play())}
        style={({ pressed }) => ({
          width: hitSize.min,
          height: hitSize.min,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.full,
          backgroundColor: colors.brandSoft,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <IconSymbol
          name={status.playing ? "pause.fill" : "play.fill"}
          color={colors.onBrandSoft}
          size={18}
        />
      </Pressable>
      <IconSymbol name="waveform" color={colors.textSecondary} size={18} />
      <Text
        style={{
          flex: 1,
          ...type.bodyStrong,
          color: colors.text,
          fontVariant: ["tabular-nums"],
          ...rtlText,
        }}
      >
        {formatSeconds(note.seconds)}
      </Text>
    </View>
  );
}

/**
 * Records the instructions the employee would otherwise type. The recording is
 * sent as its own WhatsApp voice note straight after the booking copy: a
 * specialist who reads little Arabic follows a spoken instruction far better
 * than a translated paragraph.
 */
export function DispatchVoiceNote({
  value,
  onChange,
  disabled = false,
}: {
  value: VoiceNote | null;
  onChange: (note: VoiceNote | null) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const recorder = useAudioRecorder(VOICE_NOTE_RECORDING);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seconds = Math.floor(recorderState.durationMillis / 1000);

  const stop = async (keep: boolean) => {
    setRecording(false);
    const elapsed = Math.floor(recorderState.durationMillis / 1000);
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch {
      setError("تعذّر إنهاء التسجيل.");
    }
    // Hand the session back so playback isn't stuck on the earpiece.
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    if (!keep || !uri) return;
    onChange({ uri, seconds: elapsed });
  };

  // A note that runs long is cut at the cap rather than refused on send.
  useEffect(() => {
    if (!recording || seconds < MAX_SECONDS) return;
    // Run after the effect has committed. Apart from satisfying React's effect
    // contract, this lets the last recorder-state sample settle before `stop`
    // reads its duration and prevents a cascading render at the cutoff.
    const timer = setTimeout(() => {
      warningFeedback();
      void stop(true);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, seconds]);

  const start = async () => {
    setError(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError("لا يوجد إذن للميكروفون. فعّليه من إعدادات الجهاز.");
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      tapFeedback();
    } catch {
      setError("تعذّر بدء التسجيل. حاولي مرة أخرى.");
    }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <Card>
        {recording ? (
          <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إلغاء التسجيل"
              onPress={() => void stop(false)}
              style={({ pressed }) => ({
                width: hitSize.min,
                height: hitSize.min,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                backgroundColor: colors.surfaceSunken,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <IconSymbol name="trash" color={colors.danger} size={18} />
            </Pressable>
            <View
              style={{
                flex: 1,
                flexDirection: "row-reverse",
                alignItems: "center",
                gap: spacing.sm,
                minHeight: hitSize.min,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                borderCurve: "continuous",
                backgroundColor: colors.dangerSoft,
              }}
            >
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: radius.full,
                  backgroundColor: colors.danger,
                }}
              />
              <Text
                style={{
                  ...type.bodyStrong,
                  color: colors.onDangerSoft,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatSeconds(seconds)}
              </Text>
              <Text style={{ flex: 1, ...type.footnote, color: colors.onDangerSoft, ...rtlText }}>
                جارٍ التسجيل…
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إيقاف التسجيل"
              onPress={() => void stop(true)}
              style={({ pressed }) => ({
                width: hitSize.min,
                height: hitSize.min,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                backgroundColor: colors.brand,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <IconSymbol name="checkmark" color={colors.onBrand} size={20} />
            </Pressable>
          </View>
        ) : value ? (
          <>
            <Playback note={value} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="حذف التسجيل وإعادة التسجيل"
              disabled={disabled}
              onPress={() => {
                tapFeedback();
                onChange(null);
              }}
              style={({ pressed }) => ({
                minHeight: hitSize.min,
                flexDirection: "row-reverse",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.sm,
                borderRadius: radius.md,
                opacity: disabled ? 0.45 : pressed ? 0.6 : 1,
              })}
            >
              <IconSymbol name="trash" color={colors.danger} size={17} />
              <Text style={{ ...type.subheadStrong, color: colors.danger, ...rtlText }}>
                حذف التسجيل
              </Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="تسجيل ملاحظة صوتية للأخصائية"
            disabled={disabled}
            testID="dispatch-record-voice"
            onPress={() => void start()}
            style={({ pressed }) => ({
              minHeight: hitSize.control,
              flexDirection: "row-reverse",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.sm,
              borderRadius: radius.lg,
              borderCurve: "continuous",
              backgroundColor: colors.brandSoft,
              opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
            })}
          >
            <IconSymbol name="mic" color={colors.onBrandSoft} size={20} />
            <Text style={{ ...type.bodyStrong, color: colors.onBrandSoft, ...rtlText }}>
              اضغطي للتسجيل
            </Text>
          </Pressable>
        )}
      </Card>
      {error ? <InlineAlert message={error} /> : null}
    </View>
  );
}
