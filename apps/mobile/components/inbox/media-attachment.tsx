import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";

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
  const media = useMediaUrl(slot.storage_path);
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
    return <Note text={media.error?.message ?? "تعذّر تحميل الملف"} />;
  }

  const url = media.data.url;

  if (messageType === "image") {
    return <ImageAttachment url={url} label={slot.original_filename} />;
  }
  if (messageType === "voice" || messageType === "audio") {
    return <AudioAttachment url={url} isVoice={messageType === "voice"} ink={ink} />;
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
 * A voice note, played in place.
 *
 * Only mounted once the signed URL exists, so the player hooks always get a
 * real source and never have to be swapped mid-life.
 */
function AudioAttachment({
  url,
  isVoice,
  ink,
}: {
  url: string;
  isVoice: boolean;
  ink: string;
}) {
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);

  // Playback leaves the head at the end; rewinding here means a second tap on
  // play restarts the note instead of doing nothing.
  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
  }, [status.didJustFinish, player]);

  const remaining = Math.max(0, Math.round(status.duration - status.currentTime));

  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? "إيقاف مؤقت" : "تشغيل"}
        onPress={() => (status.playing ? player.pause() : player.play())}
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
        <IconSymbol name={status.playing ? "pause.fill" : "play.fill"} color={ink} size={16} />
      </Pressable>
      <IconSymbol name={isVoice ? "waveform" : "doc"} color={ink} size={16} />
      <Text style={{ ...type.footnote, color: ink, fontVariant: ["tabular-nums"] }}>
        {status.isLoaded ? formatSeconds(remaining) : "…"}
      </Text>
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

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} م.ب` : `${Math.round(bytes / 1024)} ك.ب`;
}
