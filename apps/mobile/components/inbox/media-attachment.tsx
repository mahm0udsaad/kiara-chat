import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { useMediaUrl } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { MediaSlot } from "@/types/api";

/** Message types that carry an attachment worth rendering. */
export const MEDIA_MESSAGE_TYPES = new Set([
  "image",
  "audio",
  "voice",
  "video",
  "document",
  "file",
]);

/**
 * One attachment inside a bubble.
 *
 * The bytes live in a private bucket, so nothing can be rendered until the
 * server signs a URL for the path on the message. Images and voice notes get
 * a real player; anything else is a chip that hands off to the OS.
 */
export function MediaAttachment({
  slot,
  messageType,
  outbound,
}: {
  slot: MediaSlot;
  messageType: string;
  outbound: boolean;
}) {
  const { colors } = useTheme();
  // WhatsApp ships every voice note as Opus in an Ogg container. Android's
  // ExoPlayer demuxes it; AVFoundation — and so `expo-audio` on iOS — cannot,
  // at any codec, which is why these bubbles rendered as playable voice notes
  // and then never played. The server remuxes to CAF on request.
  const wantsCaf =
    Platform.OS === "ios" &&
    (messageType === "voice" || messageType === "audio") &&
    isOggOpus(slot.content_type);
  const media = useMediaUrl(slot.storage_path, true, wantsCaf ? "caf" : undefined);
  const ink = outbound ? colors.onBrand : colors.text;
  const quiet = outbound ? colors.onBrand : colors.textTertiary;

  if (slot.delivery_status === "too_large") {
    return <Note text={`ملف كبير لم يتم تحميله. ${formatBytes(slot.size_bytes)}`} />;
  }
  if (!slot.storage_path) {
    return <Note text={`تعذّر تخزين الملف. ${slot.content_type}`} />;
  }
  if (media.isLoading) {
    return (
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
        <ActivityIndicator size="small" color={quiet} />
        <Text style={{ ...type.footnote, color: quiet, ...rtlText }}>جارٍ التحميل…</Text>
      </View>
    );
  }
  if (media.isError || !media.data) {
    // Whatever the server says goes to the console, not into the bubble: this
    // line used to print storage's own "Object not found" between two Arabic
    // messages, telling an employee a file was gone when it was simply not
    // signed for her.
    if (media.error) console.warn("[media] load failed", media.error.message);
    return <Note text="تعذّر تحميل الملف" />;
  }

  const url = media.data.url;

  if (messageType === "image") {
    return <ImageAttachment url={url} label={slot.original_filename} />;
  }
  if (messageType === "voice" || messageType === "audio") {
    return (
      <AudioAttachment
        url={url}
        urlFetchedAt={media.dataUpdatedAt}
        refreshUrl={media.refetch}
        isVoice={messageType === "voice"}
        ink={ink}
      />
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={slot.original_filename || "فتح الملف"}
      onPress={() => void Linking.openURL(url)}
      style={({ pressed }) => ({
        flexDirection: "row-reverse",
        alignItems: "center",
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radius.md,
        borderCurve: "continuous",
        backgroundColor: outbound ? "rgba(255,255,255,0.18)" : colors.surfaceSunken,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <IconSymbol
        name={messageType === "video" ? "play.fill" : "doc.text"}
        color={ink}
        size={16}
      />
      <Text numberOfLines={1} style={{ flex: 1, ...type.footnote, color: ink, ...rtlText }}>
        {slot.original_filename || slot.content_type || "ملف"}
      </Text>
      {slot.size_bytes ? (
        <Text style={{ ...type.caption, color: quiet, fontVariant: ["tabular-nums"] }}>
          {formatBytes(slot.size_bytes)}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ImageAttachment({ url, label }: { url: string; label?: string | null }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={label || "صورة"}
        onPress={() => setExpanded(true)}
      >
        <Image
          source={url}
          contentFit="cover"
          transition={140}
          style={{
            width: 220,
            height: 220,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceSunken,
          }}
        />
      </Pressable>

      <Modal
        visible={expanded}
        transparent
        animationType="fade"
        onRequestClose={() => setExpanded(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إغلاق الصورة"
          onPress={() => setExpanded(false)}
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.92)",
          }}
        >
          <Image
            source={url}
            contentFit="contain"
            style={{ width: "100%", height: "100%" }}
          />
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * The session every in-thread playback runs under.
 *
 * iOS fills any field left out of `setAudioModeAsync` with its own default,
 * and that default is `playsInSilentMode: false` — the `.ambient` category,
 * which the ring/silent switch mutes. Staff keep their phones on silent at
 * work, so voice notes "played" with the timer running and no sound, and
 * resetting after a recording with `{ allowsRecording: false }` alone put the
 * session straight back into that state. Always pass the whole mode.
 */
export const PLAYBACK_AUDIO_MODE = {
  playsInSilentMode: true,
  allowsRecording: false,
  interruptionMode: "doNotMix",
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
} as const;

/** A signed URL is good for an hour; refresh well before a tap can hit it. */
const URL_FRESH_MS = 40 * 60_000;
/** A player that has not loaded by then is not going to. */
const LOAD_TIMEOUT_MS = 15_000;

/**
 * A voice note, played in place.
 *
 * No native player exists until the employee taps play. A thread used to
 * build one per voice note on open — dozens of prepared decoders, each holding
 * a signed URL that expired an hour later — and a player that failed once
 * (an expired URL, a dropped connection, a decoder the device would not hand
 * out) stayed dead with a "…" and a play button that did nothing, until
 * something else happened to remount the bubble. Now the tap fetches a fresh
 * URL if needed, builds the player, and a failure offers a real retry.
 */
function AudioAttachment({
  url,
  urlFetchedAt,
  refreshUrl,
  isVoice,
  ink,
}: {
  url: string;
  urlFetchedAt: number;
  refreshUrl: () => Promise<unknown>;
  isVoice: boolean;
  ink: string;
}) {
  const [armed, setArmed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [failed, setFailed] = useState(false);
  // Stable, because the player below re-renders on every status tick and its
  // load timeout must not restart each time.
  const fail = useCallback(() => setFailed(true), []);

  const start = async () => {
    if (preparing) return;
    setPreparing(true);
    setFailed(false);
    try {
      await setAudioModeAsync(PLAYBACK_AUDIO_MODE).catch(() => {});
      if (failed || Date.now() - urlFetchedAt > URL_FRESH_MS) await refreshUrl();
      setAttempt((value) => value + 1);
      setArmed(true);
    } finally {
      setPreparing(false);
    }
  };

  if (!armed || failed) {
    return (
      <AudioRow
        ink={ink}
        isVoice={isVoice}
        icon={failed ? "arrow.clockwise" : "play.fill"}
        label={failed ? "إعادة المحاولة" : "تشغيل"}
        busy={preparing}
        text={failed ? "تعذّر التشغيل" : ""}
        onPress={() => void start()}
      />
    );
  }

  return (
    <LiveAudio
      key={`${url}#${attempt}`}
      url={url}
      isVoice={isVoice}
      ink={ink}
      onFailed={fail}
    />
  );
}

function LiveAudio({
  url,
  isVoice,
  ink,
  onFailed,
}: {
  url: string;
  isVoice: boolean;
  ink: string;
  onFailed: () => void;
}) {
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);

  // Mounted by a tap on play, so start straight away.
  useEffect(() => {
    player.play();
  }, [player]);

  useEffect(() => {
    if (status.error) {
      console.warn("[media] voice note failed", status.error);
      onFailed();
    }
  }, [status.error, onFailed]);

  useEffect(() => {
    if (status.isLoaded) return;
    const timer = setTimeout(onFailed, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status.isLoaded, onFailed]);

  // Playback leaves the head at the end; rewinding here means a second tap on
  // play restarts the note instead of doing nothing.
  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
  }, [status.didJustFinish, player]);

  const remaining = Math.max(0, Math.round(status.duration - status.currentTime));

  return (
    <AudioRow
      ink={ink}
      isVoice={isVoice}
      icon={status.playing ? "pause.fill" : "play.fill"}
      label={status.playing ? "إيقاف مؤقت" : "تشغيل"}
      busy={!status.isLoaded}
      text={status.isLoaded ? formatSeconds(remaining) : ""}
      onPress={() => {
        if (status.playing) {
          player.pause();
          return;
        }
        // Another recording or call may have changed the session since.
        void setAudioModeAsync(PLAYBACK_AUDIO_MODE)
          .catch(() => {})
          .then(() => player.play());
      }}
    />
  );
}

function AudioRow({
  ink,
  isVoice,
  icon,
  label,
  busy,
  text,
  onPress,
}: {
  ink: string;
  isVoice: boolean;
  icon: "play.fill" | "pause.fill" | "arrow.clockwise";
  label: string;
  busy: boolean;
  text: string;
  onPress: () => void;
}) {
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm, minWidth: 140 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        hitSlop={spacing.sm}
        style={({ pressed }) => ({
          width: 34,
          height: 34,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.full,
          backgroundColor: "rgba(127,127,127,0.22)",
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {busy ? (
          <ActivityIndicator size="small" color={ink} />
        ) : (
          <IconSymbol name={icon} color={ink} size={16} />
        )}
      </Pressable>
      <IconSymbol name={isVoice ? "waveform" : "doc"} color={ink} size={16} />
      {text ? (
        <Text style={{ ...type.footnote, color: ink, fontVariant: ["tabular-nums"], ...rtlText }}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

function Note({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radius.md,
        backgroundColor: colors.warningSoft,
      }}
    >
      <Text style={{ ...type.footnote, color: colors.onWarningSoft, ...rtlText }}>{text}</Text>
    </View>
  );
}

/** The container WhatsApp voice notes arrive in, on every transport. */
function isOggOpus(contentType: string | null | undefined): boolean {
  const ct = (contentType || "").toLowerCase();
  return ct.startsWith("audio/ogg") || ct.startsWith("audio/opus");
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} م.ب` : `${Math.round(bytes / 1024)} ك.ب`;
}
