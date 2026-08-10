import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/primary-button";
import { ErrorState, InlineAlert, LoadingScreen } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  bookingStageLabel,
  csStatusLabel,
  csStatusTone,
  formatters,
  relativeDayLabel,
} from "@/lib/format";
import { commitFeedback } from "@/lib/haptics";
import {
  useBootstrap,
  useConversation,
  useMarkConversationRead,
  useReply,
  useTakeConversation,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { ConversationMessage } from "@/types/api";

/** A message, or the date chip that introduces the messages below it. */
type ChatItem =
  | { kind: "message"; message: ConversationMessage }
  | { kind: "day"; id: string; label: string };

/**
 * Builds the render list newest-first (the list is inverted) and injects a day
 * separator whenever the calendar date changes.
 */
function buildChatItems(messages: ConversationMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    items.push({ kind: "message", message });

    const previous = messages[index - 1];
    const isDayBoundary =
      !previous ||
      new Date(previous.created_at).toDateString() !==
        new Date(message.created_at).toDateString();
    if (isDayBoundary) {
      items.push({
        kind: "day",
        id: `day-${message.id}`,
        label: relativeDayLabel(message.created_at),
      });
    }
  }
  return items;
}

function DaySeparator({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: spacing.sm }}>
      <View
        style={{
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
          borderRadius: radius.full,
          backgroundColor: colors.surfaceSunken,
        }}
      >
        <Text style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>{label}</Text>
      </View>
    </View>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const { colors } = useTheme();

  // System notes are the app talking about the conversation, not a party in it,
  // so they get a centred neutral chip rather than a speech bubble.
  if (message.role === "system") {
    return (
      <View style={{ alignItems: "center", paddingVertical: spacing.xs }}>
        <View
          style={{
            maxWidth: "88%",
            flexDirection: "row-reverse",
            alignItems: "center",
            gap: spacing.xs + 2,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderRadius: radius.md,
            backgroundColor: colors.surfaceSunken,
          }}
        >
          <IconSymbol name="info.circle" color={colors.textTertiary} size={14} />
          <Text
            selectable
            style={{ flex: 1, ...type.footnote, color: colors.textSecondary, ...rtlText }}
          >
            {message.content || "تحديث النظام"}
          </Text>
        </View>
      </View>
    );
  }

  const outbound = message.role === "agent";
  const isMedia = !message.content;

  return (
    <View
      style={{
        maxWidth: "84%",
        alignSelf: outbound ? "flex-start" : "flex-end",
        paddingHorizontal: spacing.md + 2,
        paddingVertical: spacing.sm + 2,
        gap: spacing.xs,
        borderRadius: radius.lg + 2,
        borderCurve: "continuous",
        // Tail corner: the bubble squares off on the side it is anchored to.
        borderBottomStartRadius: outbound ? radius.sm - 2 : radius.lg + 2,
        borderBottomEndRadius: outbound ? radius.lg + 2 : radius.sm - 2,
        backgroundColor: outbound ? colors.brand : colors.surface,
        borderWidth: outbound ? 0 : 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.xs + 2 }}>
        {isMedia ? (
          <IconSymbol
            name="paperplane.fill"
            color={outbound ? colors.onBrand : colors.textTertiary}
            size={14}
          />
        ) : null}
        <Text
          selectable
          style={{
            ...type.body,
            color: outbound ? colors.onBrand : colors.text,
            fontStyle: isMedia ? "italic" : "normal",
            ...rtlText,
          }}
        >
          {message.content || "رسالة وسائط"}
        </Text>
      </View>
      <Text
        style={{
          ...type.caption,
          fontWeight: "400",
          opacity: 0.75,
          color: outbound ? colors.onBrand : colors.textTertiary,
          fontVariant: ["tabular-nums"],
          textAlign: "left",
        }}
      >
        {formatters.time.format(new Date(message.created_at))}
      </Text>
    </View>
  );
}

export default function ConversationScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = useMemo(
    () => (Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "")),
    [params.id],
  );

  const conversation = useConversation(id);
  const bootstrap = useBootstrap();
  const { mutate: markRead } = useMarkConversationRead(id);
  const take = useTakeConversation(id);
  const reply = useReply(id);
  const [draft, setDraft] = useState("");

  const messages = conversation.data?.messages;
  const chatItems = useMemo(() => buildChatItems(messages ?? []), [messages]);

  useEffect(() => {
    if ((conversation.data?.conversation.unread_count ?? 0) > 0) markRead();
  }, [conversation.data?.conversation.unread_count, markRead]);

  if (conversation.isLoading) return <LoadingScreen label="جارٍ فتح المحادثة…" />;
  if (conversation.isError || !conversation.data) {
    return (
      <ErrorState
        title="تعذر فتح المحادثة"
        message={conversation.error?.message ?? "المحادثة غير موجودة"}
        onRetry={() => void conversation.refetch()}
      />
    );
  }

  const current = conversation.data.conversation;
  const isAssignedToMe = Boolean(
    bootstrap.data?.session.teamMemberId &&
      current.assigned_to === bootstrap.data.session.teamMemberId,
  );
  const canSend = Boolean(draft.trim()) && !reply.isPending;

  const send = () => {
    const text = draft.trim();
    if (!text || reply.isPending) return;
    commitFeedback();
    reply.mutate(text, { onSuccess: () => setDraft("") });
  };

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top + 44}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Screen options={{ title: current.customer_name || current.customer_phone }} />

      {/* Pinned context strip — status must stay visible while scrolling back. */}
      <View
        style={{
          flexDirection: "row-reverse",
          alignItems: "center",
          flexWrap: "wrap",
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <Badge label={csStatusLabel[current.csStatus]} tone={csStatusTone[current.csStatus]} />
        {current.bookingStage ? (
          <Badge label={bookingStageLabel[current.bookingStage]} tone="neutral" />
        ) : null}
        <Text
          selectable
          style={{
            ...type.caption,
            color: colors.textTertiary,
            fontVariant: ["tabular-nums"],
            ...rtlText,
          }}
        >
          {current.customer_phone}
        </Text>
      </View>

      <FlatList
        // Inverted so new messages land at the bottom without manual scrolling.
        inverted
        data={chatItems}
        keyExtractor={(item) => (item.kind === "day" ? item.id : item.message.id)}
        renderItem={({ item }) =>
          item.kind === "day" ? (
            <DaySeparator label={item.label} />
          ) : (
            <MessageBubble message={item.message} />
          )
        }
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.sm + 2,
          flexGrow: 1,
          justifyContent: "flex-start",
        }}
        keyboardDismissMode="interactive"
      />

      <View
        style={{
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.md,
          paddingBottom: spacing.md + insets.bottom,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        {!isAssignedToMe ? (
          <>
            {take.error ? <InlineAlert message={take.error.message} /> : null}
            {current.assigned_to ? (
              <InlineAlert
                tone="warning"
                message="هذه المحادثة مستلمة من موظف آخر. لا يمكنك الرد عليها الآن."
              />
            ) : (
              <PrimaryButton
                label="استلام المحادثة"
                icon="checkmark.circle"
                loading={take.isPending}
                onPress={() => take.mutate()}
              />
            )}
          </>
        ) : (
          <>
            {reply.error ? <InlineAlert message={reply.error.message} /> : null}
            <View style={{ flexDirection: "row-reverse", alignItems: "flex-end", gap: spacing.sm }}>
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إرسال الرد"
                accessibilityState={{ disabled: !canSend, busy: reply.isPending }}
                disabled={!canSend}
                onPress={send}
                style={({ pressed }) => ({
                  width: hitSize.comfortable,
                  height: hitSize.comfortable,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.full,
                  backgroundColor: colors.brand,
                  opacity: !canSend ? 0.4 : pressed ? 0.75 : 1,
                  transform: [{ scale: pressed && canSend ? 0.92 : 1 }],
                })}
              >
                <IconSymbol name="arrow.up" color={colors.onBrand} size={22} />
              </Pressable>
            </View>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
