import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { VOICE_NOTE_RECORDING } from "@/lib/audio-recording";

import {
  AttachmentPreview,
  type PendingAttachment,
} from "@/components/inbox/attachment-preview";
import { CatalogSheet } from "@/components/inbox/catalog-sheet";
import { PrimaryButton } from "@/components/primary-button";
import { SavedRepliesSheet } from "@/components/inbox/saved-replies-sheet";
import { TemplatesSheet } from "@/components/inbox/templates-sheet";
import { InlineAlert } from "@/components/screen-state";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { commitFeedback, errorFeedback, tapFeedback } from "@/lib/haptics";
import { MAX_UPLOAD_BYTES, formatMegabytes } from "@/lib/api";
import { useBootstrap, useReply, useSendMedia } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { CatalogItem } from "@/types/api";

/** Matches the server's cap, so an oversized file fails before it uploads. */
/** The longest edge a photo is re-encoded to before it leaves the phone. */
const MAX_IMAGE_EDGE = 1280;

/**
 * The reply box: text, attachments, voice notes, and the service picker —
 * the same four things the web composer offers.
 *
 * Attachments are staged for review rather than sent on pick (WhatsApp's
 * order of operations), while a voice note sends the moment recording stops
 * because there is nothing to preview.
 */
export function Composer({
  conversationId,
  templateOnly = false,
}: {
  conversationId: string;
  /** An empty outbound thread must begin with an approved WhatsApp template. */
  templateOnly?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reply = useReply(conversationId);
  const sendMedia = useSendMedia(conversationId);
  const savedReplies = useBootstrap().data?.savedReplies ?? [];

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const recorder = useAudioRecorder(VOICE_NOTE_RECORDING);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [recording, setRecording] = useState(false);
  const textAttempt = useRef<{ text: string; idempotencyKey: string } | null>(null);

  const canSendText = Boolean(draft.trim()) && !reply.isPending;

  /**
   * Stage picked files. Whatever was already typed rides along as the first
   * file's caption instead of being left behind in the box.
   */
  const stage = useCallback(
    (files: Omit<PendingAttachment, "caption">[]) => {
      if (!files.length) return;
      setMediaError(null);
      setPending((previous) => {
        const typed = previous.length === 0 ? draft.trim() : "";
        if (typed) setDraft("");
        return [
          ...previous,
          ...files.map((file, index) => ({
            ...file,
            caption: index === 0 ? typed : "",
          })),
        ];
      });
    },
    [draft],
  );

  const pickFromLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMediaError("لا يوجد إذن للوصول إلى الصور. فعّليه من إعدادات الجهاز.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: 5,
      quality: 0.85,
    });
    if (result.canceled) return;

    const oversized = result.assets.filter(
      (asset) => (asset.fileSize ?? 0) > MAX_UPLOAD_BYTES,
    );
    if (oversized.length) {
      setMediaError(
        `بعض الملفات أكبر من الحد المسموح (${formatMegabytes(MAX_UPLOAD_BYTES)}).`,
      );
    }
    stage(
      result.assets
        .filter((asset) => (asset.fileSize ?? 0) <= MAX_UPLOAD_BYTES)
        .map((asset, index) => {
          const isImage = asset.type !== "video";
          return {
            id: Crypto.randomUUID(),
            uri: asset.uri,
            name: asset.fileName ?? fallbackName(asset.uri, isImage ? "jpg" : "mp4"),
            mimeType: asset.mimeType ?? (isImage ? "image/jpeg" : "video/mp4"),
            isImage,
          };
        }),
    );
  }, [stage]);

  const takePhoto = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMediaError("لا يوجد إذن للكاميرا. فعّليه من إعدادات الجهاز.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    stage([
      {
        id: Crypto.randomUUID(),
        uri: asset.uri,
        name: asset.fileName ?? fallbackName(asset.uri, "jpg"),
        mimeType: asset.mimeType ?? "image/jpeg",
        isImage: true,
      },
    ]);
  }, [stage]);

  const pickDocument = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    if ((asset.size ?? 0) > MAX_UPLOAD_BYTES) {
      setMediaError(
        `الملف أكبر من الحد المسموح (${formatMegabytes(MAX_UPLOAD_BYTES)}).`,
      );
      return;
    }
    const mimeType = asset.mimeType ?? "application/octet-stream";
    stage([
      {
        id: Crypto.randomUUID(),
        uri: asset.uri,
        name: asset.name || fallbackName(asset.uri, "bin"),
        mimeType,
        isImage: mimeType.startsWith("image/"),
      },
    ]);
  }, [stage]);

  /**
   * A picked service goes in as its photo plus the price text as the caption,
   * so one send carries both. Services with no photo — or whose photo won't
   * decode — still fill the draft the way the text-only picker always did.
   */
  const pickCatalogItem = useCallback(
    async (item: CatalogItem, text: string) => {
      const appendToDraft = () =>
        setDraft((current) => (current.trim() ? `${current.trim()}\n${text}` : text));

      if (!item.imageUrl) {
        appendToDraft();
        return;
      }
      setCatalogBusy(true);
      const uri = await catalogImageUri(item.imageUrl).catch(() => null);
      setCatalogBusy(false);
      if (!uri) {
        appendToDraft();
        return;
      }
      setPending((previous) => {
        const typed = previous.length === 0 ? draft.trim() : "";
        if (typed) setDraft("");
        return [
          ...previous,
          {
            id: Crypto.randomUUID(),
            uri,
            name: `${item.name.replace(/[^\p{L}\p{N}\s-]/gu, "").trim().slice(0, 40) || "service"}.jpg`,
            mimeType: "image/jpeg",
            isImage: true,
            caption: typed ? `${typed}\n${text}` : text,
          },
        ];
      });
    },
    [draft],
  );

  const discardPending = useCallback(() => {
    setPending([]);
    setActiveIndex(0);
    setMediaError(null);
  }, []);

  const removePending = useCallback((id: string) => {
    setPending((previous) => {
      const next = previous.filter((attachment) => attachment.id !== id);
      setActiveIndex((index) => Math.max(0, Math.min(index, next.length - 1)));
      return next;
    });
  }, []);

  /** Send every staged file in order, each with its own caption. */
  const sendPending = useCallback(async () => {
    if (!pending.length) return;
    setMediaError(null);
    setUploading(true);
    try {
      for (const attachment of pending) {
        await sendMedia.mutateAsync({
          file: {
            uri: attachment.uri,
            name: attachment.name,
            type: attachment.mimeType,
          },
          caption: attachment.caption.trim(),
          voiceNote: attachment.voiceNote,
          idempotencyKey: attachment.id,
        });
        // Remove each success immediately. If a later file fails, retrying the
        // modal contains only work the server has not already accepted.
        removePending(attachment.id);
      }
      commitFeedback();
      setMediaError(null);
    } catch (error) {
      errorFeedback();
      setMediaError(error instanceof Error ? error.message : "تعذّر إرسال الملف");
    } finally {
      setUploading(false);
    }
  }, [pending, sendMedia, removePending]);

  const startRecording = useCallback(async () => {
    setMediaError(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setMediaError("لا يوجد إذن للميكروفون. فعّليه من إعدادات الجهاز.");
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      tapFeedback();
    } catch {
      setMediaError("تعذّر بدء التسجيل. حاولي مرة أخرى.");
    }
  }, [recorder]);

  const finishRecording = useCallback(
    async (send: boolean) => {
      setRecording(false);
      let uri: string | null = null;
      try {
        await recorder.stop();
        uri = recorder.uri;
      } catch {
        setMediaError("تعذّر إنهاء التسجيل.");
      }
      // Hand the session back so playback isn't stuck on the earpiece.
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (!send || !uri) return;

      setUploading(true);
      const idempotencyKey = Crypto.randomUUID();
      try {
        await sendMedia.mutateAsync({
          file: { uri, name: `voice-${Date.now()}.m4a`, type: "audio/mp4" },
          voiceNote: true,
          idempotencyKey,
        });
        commitFeedback();
      } catch (error) {
        errorFeedback();
        // Keep the exact recording and request id. The employee can retry it
        // from the ordinary attachment review instead of recording it again.
        setPending([
          {
            id: idempotencyKey,
            uri,
            name: `voice-${Date.now()}.m4a`,
            mimeType: "audio/mp4",
            isImage: false,
            caption: "",
            voiceNote: true,
          },
        ]);
        setMediaError(
          error instanceof Error ? error.message : "تعذّر إرسال الملاحظة الصوتية",
        );
      } finally {
        setUploading(false);
      }
    },
    [recorder, sendMedia],
  );

  const sendText = () => {
    const text = draft.trim();
    if (!text || reply.isPending) return;
    const attempt =
      textAttempt.current?.text === text
        ? textAttempt.current
        : { text, idempotencyKey: Crypto.randomUUID() };
    textAttempt.current = attempt;
    commitFeedback();
    reply.mutate(attempt, {
      onSuccess: () => {
        textAttempt.current = null;
        setDraft("");
      },
    });
  };

  const runFromMenu = (action: () => void | Promise<void>) => {
    setMenuOpen(false);
    // Let the sheet finish dismissing before a system picker takes the screen;
    // presenting both at once leaves iOS showing neither.
    setTimeout(() => void action(), 220);
  };

  return (
    <View style={{ gap: spacing.sm }}>
      {templateOnly ? (
        <View style={{ gap: spacing.sm }}>
          <InlineAlert
            tone="info"
            message="لم تبدأ المحادثة بعد. يجب إرسال قالب واتساب معتمد أولًا."
          />
          <PrimaryButton
            testID="start-with-template"
            label="إرسال قالب لبدء المحادثة"
            icon="paperplane.fill"
            onPress={() => {
              tapFeedback();
              setTemplatesOpen(true);
            }}
          />
        </View>
      ) : (
        <>
          {reply.error ? <InlineAlert message={reply.error.message} /> : null}
          {mediaError ? <InlineAlert message={mediaError} /> : null}

          {recording ? (
            <RecordingBar
              seconds={Math.floor(recorderState.durationMillis / 1000)}
              onCancel={() => void finishRecording(false)}
              onSend={() => void finishRecording(true)}
            />
          ) : (
            <View
              style={{
                flexDirection: "row-reverse",
                alignItems: "flex-end",
                gap: spacing.sm,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إرفاق ملف أو باقة"
                disabled={uploading || catalogBusy}
                onPress={() => {
                  tapFeedback();
                  setMenuOpen(true);
                }}
                style={({ pressed }) => ({
                  width: hitSize.comfortable,
                  height: hitSize.comfortable,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.full,
                  backgroundColor: colors.surfaceSunken,
                  opacity: uploading || catalogBusy ? 0.5 : pressed ? 0.7 : 1,
                })}
              >
                {catalogBusy ? (
                  <ActivityIndicator color={colors.textSecondary} />
                ) : (
                  <IconSymbol name="plus" color={colors.textSecondary} size={22} />
                )}
              </Pressable>

              <TextInput
                accessibilityLabel="نص الرد"
                multiline
                placeholder="اكتبي الرد…"
                placeholderTextColor={colors.textTertiary}
                value={draft}
                onChangeText={setDraft}
                style={{
                  flex: 1,
                  minHeight: hitSize.comfortable,
                  maxHeight: 132,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius["2xl"],
                  borderCurve: "continuous",
                  backgroundColor: colors.surfaceSunken,
                  ...type.body,
                  color: colors.text,
                  ...rtlText,
                }}
              />

              {/* One button, two jobs — the microphone becomes send as soon as
                  there is something to send, exactly like WhatsApp. */}
              {draft.trim() ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="إرسال الرد"
                  accessibilityState={{ disabled: !canSendText, busy: reply.isPending }}
                  disabled={!canSendText}
                  onPress={sendText}
                  style={({ pressed }) => ({
                    width: hitSize.comfortable,
                    height: hitSize.comfortable,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.full,
                    backgroundColor: colors.brand,
                    opacity: !canSendText ? 0.4 : pressed ? 0.75 : 1,
                    transform: [{ scale: pressed && canSendText ? 0.92 : 1 }],
                  })}
                >
                  <IconSymbol name="arrow.up" color={colors.onBrand} size={22} />
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="تسجيل ملاحظة صوتية"
                  disabled={uploading}
                  onPress={() => void startRecording()}
                  style={({ pressed }) => ({
                    width: hitSize.comfortable,
                    height: hitSize.comfortable,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.full,
                    backgroundColor: colors.brand,
                    opacity: uploading ? 0.5 : pressed ? 0.75 : 1,
                  })}
                >
                  {uploading ? (
                    <ActivityIndicator color={colors.onBrand} />
                  ) : (
                    <IconSymbol name="mic.fill" color={colors.onBrand} size={22} />
                  )}
                </Pressable>
              )}
            </View>
          )}
        </>
      )}

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إغلاق القائمة"
          onPress={() => setMenuOpen(false)}
          style={{ flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay }}
        >
          <Pressable
            // Swallows the taps that would otherwise dismiss through the scrim.
            onPress={() => {}}
            style={{
              gap: spacing.xs,
              padding: spacing.lg,
              paddingBottom: spacing.lg + insets.bottom,
              borderTopLeftRadius: radius["2xl"],
              borderTopRightRadius: radius["2xl"],
              borderCurve: "continuous",
              backgroundColor: colors.surface,
            }}
          >
            {savedReplies.length ? (
              <MenuRow
                icon="doc.text"
                label="الرسائل الجاهزة"
                onPress={() => runFromMenu(() => setRepliesOpen(true))}
              />
            ) : null}
            <MenuRow
              icon="paperplane.fill"
              label="قوالب"
              onPress={() => runFromMenu(() => setTemplatesOpen(true))}
            />
            <MenuRow
              icon="sparkles"
              label="الباقات والخدمات"
              onPress={() => runFromMenu(() => setCatalogOpen(true))}
            />
            <MenuRow
              icon="photo"
              label="صورة أو فيديو"
              onPress={() => runFromMenu(pickFromLibrary)}
            />
            <MenuRow icon="camera" label="التقاط صورة" onPress={() => runFromMenu(takePhoto)} />
            <MenuRow icon="doc" label="ملف" onPress={() => runFromMenu(pickDocument)} />
          </Pressable>
        </Pressable>
      </Modal>

      <SavedRepliesSheet
        open={repliesOpen}
        replies={savedReplies}
        onClose={() => setRepliesOpen(false)}
        onPick={(saved) =>
          setDraft((current) =>
            current.trim() ? `${current.trim()}\n${saved.body}` : saved.body,
          )
        }
      />

      <TemplatesSheet
        open={templatesOpen}
        conversationId={conversationId}
        onClose={() => setTemplatesOpen(false)}
      />

      <CatalogSheet
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onPick={(item, text) => void pickCatalogItem(item, text)}
      />

      <AttachmentPreview
        attachments={pending}
        activeIndex={activeIndex}
        sending={uploading}
        error={mediaError}
        onSetActive={setActiveIndex}
        onChangeCaption={(id, caption) =>
          setPending((previous) =>
            previous.map((attachment) =>
              attachment.id === id ? { ...attachment, caption } : attachment,
            ),
          )
        }
        onRemove={removePending}
        onClose={discardPending}
        onSend={() => void sendPending()}
      />
    </View>
  );
}

function RecordingBar({
  seconds,
  onCancel,
  onSend,
}: {
  seconds: number;
  onCancel: () => void;
  onSend: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="إلغاء التسجيل"
        onPress={onCancel}
        style={({ pressed }) => ({
          width: hitSize.comfortable,
          height: hitSize.comfortable,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.full,
          backgroundColor: colors.surfaceSunken,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <IconSymbol name="trash" color={colors.danger} size={20} />
      </Pressable>

      <View
        style={{
          flex: 1,
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.sm,
          minHeight: hitSize.comfortable,
          paddingHorizontal: spacing.lg,
          borderRadius: radius["2xl"],
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
          {formatDuration(seconds)}
        </Text>
        <Text style={{ flex: 1, ...type.footnote, color: colors.onDangerSoft, ...rtlText }}>
          جارٍ التسجيل…
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="إيقاف التسجيل وإرسال"
        onPress={onSend}
        style={({ pressed }) => ({
          width: hitSize.comfortable,
          height: hitSize.comfortable,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.full,
          backgroundColor: colors.brand,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <IconSymbol name="arrow.up" color={colors.onBrand} size={22} />
      </Pressable>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: "row-reverse",
        alignItems: "center",
        gap: spacing.md,
        minHeight: hitSize.control,
        paddingHorizontal: spacing.md,
        borderRadius: radius.lg,
        borderCurve: "continuous",
        backgroundColor: pressed ? colors.surfaceSunken : "transparent",
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.full,
          backgroundColor: colors.brandSoft,
        }}
      >
        <IconSymbol name={icon} color={colors.onBrandSoft} size={18} />
      </View>
      <Text style={{ flex: 1, ...type.body, color: colors.text, ...rtlText }}>{label}</Text>
    </Pressable>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function fallbackName(uri: string, extension: string): string {
  const guess = uri.split("/").pop();
  return guess && guess.includes(".") ? guess : `file-${Date.now()}.${extension}`;
}

/**
 * The service photo, re-encoded as a JPEG the phone can upload.
 *
 * Rekaz serves multi-megabyte WebP, and WhatsApp treats `image/webp` as a
 * sticker rather than a photo — the same two problems the web composer solves
 * with a canvas.
 */
async function catalogImageUri(imageUrl: string): Promise<string> {
  const loaded = await ImageManipulator.manipulate(imageUrl).renderAsync();
  const longestEdge = Math.max(loaded.width, loaded.height);
  const sized =
    longestEdge > MAX_IMAGE_EDGE
      ? await ImageManipulator.manipulate(loaded)
          .resize(
            loaded.width >= loaded.height
              ? { width: MAX_IMAGE_EDGE }
              : { height: MAX_IMAGE_EDGE },
          )
          .renderAsync()
      : loaded;
  const saved = await sized.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  return saved.uri;
}
