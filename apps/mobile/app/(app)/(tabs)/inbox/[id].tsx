import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Composer } from "@/components/inbox/composer";
import {
  MEDIA_MESSAGE_TYPES,
  MediaAttachment,
} from "@/components/inbox/media-attachment";
import { PrimaryButton } from "@/components/primary-button";
import { ReminderConfirmationStrip } from "@/components/reminder-confirmation-strip";
import { TypingIndicator } from "@/components/typing-indicator";
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
import {
  useBootstrap,
  useConversation,
  useMarkConversationRead,
  useTakeConversation,
  useTakeOverConversation,
  useUpdateReminderConfirmation,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import { useInboxLive } from "@/providers/inbox-live-provider";
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
  const slots = MEDIA_MESSAGE_TYPES.has(message.message_type)
    ? (message.metadata?.media ?? [])
    : [];
  // A media message with no caption and nothing renderable still needs to say
  // *something*, otherwise the bubble is an empty box.
  const placeholder = slots.length === 0 && !message.content;

  return (
    <View
      style={{
        maxWidth: slots.length ? "88%" : "84%",
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
      {slots.map((slot, index) => (
        <MediaAttachment
          key={slot.storage_path ?? `${message.id}-${index}`}
          slot={slot}
          messageType={message.message_type}
          outbound={outbound}
        />
      ))}

      {message.content || placeholder ? (
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.xs + 2 }}>
          {placeholder ? (
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
              fontStyle: placeholder ? "italic" : "normal",
              ...rtlText,
            }}
          >
            {message.content || "رسالة وسائط"}
          </Text>
        </View>
      ) : null}
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
  const { isTyping } = useInboxLive();
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
  const takeover = useTakeOverConversation(id);
  const reminderConfirmation = useUpdateReminderConfirmation(id);
  const [takeoverReason, setTakeoverReason] = useState("");

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
  const isAdmin = bootstrap.data?.session.role === "admin";
  const canUpdateReminder = isAdmin || isAssignedToMe;
  // Being an admin is not itself permission to reply into someone else's
  // thread. The server returns TAKEOVER_REQUIRED for that, and the composer
  // below offers the takeover instead of a text box.
  const canReply = isAssignedToMe;
  const assignedName =
    bootstrap.data?.agents.find((agent) => agent.id === current.assigned_to)
      ?.fullName ?? "موظفة أخرى";

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top + 44}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <Stack.Screen options={{ title: current.customer_name || current.customer_phone }} />

      {/* Pinned context strip — status must stay visible while scrolling back.
          Kept to a single line: `nowrap` plus a shrinking phone means a long
          booking-stage label truncates the number instead of wrapping the whole
          strip onto a second row and pushing the conversation down. */}
      <View
        style={{
          flexDirection: "row-reverse",
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
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
          numberOfLines={1}
          style={{
            flexShrink: 1,
            ...type.caption,
            color: colors.textTertiary,
            fontVariant: ["tabular-nums"],
            // A phone number is an LTR run; without this the leading "+" is
            // reordered to the end and the digit groups read backwards.
            writingDirection: "ltr",
            textAlign: "left",
          }}
        >
          {current.customer_phone}
        </Text>
      </View>

      {current.reminderConfirmation ? (
        <ReminderConfirmationStrip
          reminder={current.reminderConfirmation}
          canEdit={canUpdateReminder}
          pendingStatus={
            reminderConfirmation.isPending
              ? reminderConfirmation.variables.status
              : null
          }
          error={reminderConfirmation.error?.message ?? null}
          onChange={(status) =>
            reminderConfirmation.mutate({
              dayKey: current.reminderConfirmation!.dayKey,
              status,
            })
          }
        />
      ) : null}

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

      {isTyping(id) ? (
        <View
          style={{
            alignSelf: "flex-end",
            marginHorizontal: spacing.lg,
            marginBottom: spacing.sm,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
            borderRadius: radius.lg,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <TypingIndicator label={false} />
        </View>
      ) : null}

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
        {!canReply ? (
          <>
            {take.error ? <InlineAlert message={take.error.message} /> : null}
            {takeover.error ? <InlineAlert message={takeover.error.message} /> : null}
            {!current.assigned_to ? (
              <PrimaryButton
                label="استلام المحادثة"
                icon="checkmark.circle"
                loading={take.isPending}
                onPress={() => take.mutate()}
              />
            ) : isAdmin ? (
              // An admin may override a colleague, but not silently: the reason
              // is required here because it is what the owner report shows
              // alongside the override.
              <View style={{ gap: spacing.sm }}>
                <InlineAlert
                  tone="warning"
                  message={`هذه المحادثة مستلمة من ${assignedName}. لاستلامها اكتبي السبب.`}
                />
                <TextInput
                  accessibilityLabel="سبب استلام المحادثة من موظفة أخرى"
                  placeholder="سبب الاستلام…"
                  placeholderTextColor={colors.textTertiary}
                  value={takeoverReason}
                  onChangeText={setTakeoverReason}
                  style={{
                    minHeight: hitSize.comfortable,
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.lg,
                    backgroundColor: colors.surfaceSunken,
                    color: colors.text,
                    ...type.body,
                    ...rtlText,
                  }}
                />
                <PrimaryButton
                  label="استلام مع تسجيل السبب"
                  icon="checkmark.circle"
                  loading={takeover.isPending}
                  disabled={takeoverReason.trim().length < 3}
                  onPress={() =>
                    takeover.mutate(takeoverReason.trim(), {
                      onSuccess: () => setTakeoverReason(""),
                    })
                  }
                />
              </View>
            ) : (
              <InlineAlert
                tone="warning"
                message="هذه المحادثة مستلمة من موظف آخر. لا يمكنك الرد عليها الآن."
              />
            )}
          </>
        ) : (
          <Composer conversationId={id} />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
