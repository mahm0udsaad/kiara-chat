import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { memo, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BookingSheet } from "@/components/inbox/booking-sheet";
import { Composer } from "@/components/inbox/composer";
import { ConversationActionsButton } from "@/components/conversation-actions-button";
import {
  MEDIA_MESSAGE_TYPES,
  MediaAttachment,
} from "@/components/inbox/media-attachment";
import { PrimaryButton } from "@/components/primary-button";
import { TypingIndicator } from "@/components/typing-indicator";
import { ErrorState, InlineAlert, LoadingScreen } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  findSharedLocation,
  findSharedLocations,
  locationFromMessage,
  PIN_TYPES,
} from "@/lib/location";
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
  useConversationMessages,
  useDismissBookingRequest,
  useMarkConversationRead,
  useTakeConversation,
  useTakeOverConversation,
  useUpdateConversationActions,
} from "@/lib/queries";
import { tapFeedback } from "@/lib/haptics";
import { useTheme } from "@/providers/theme-provider";
import { useIsTyping } from "@/providers/inbox-live-provider";
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

const MessageBubble = memo(function MessageBubble({ message }: { message: ConversationMessage }) {
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
  const sharedLocation = locationFromMessage(message);
  const rendersAsLocation =
    PIN_TYPES.has(message.message_type) ||
    Boolean(sharedLocation?.url && sharedLocation.source !== "text");
  const slots = MEDIA_MESSAGE_TYPES.has(message.message_type)
    ? (message.metadata?.media ?? [])
    : [];
  // A media message with no caption and nothing renderable still needs to say
  // *something*, otherwise the bubble is an empty box.
  const placeholder = slots.length === 0 && !message.content;
  // In a group, "who said this" is the whole point — the ingest webhook stamps
  // it on the message because the thread itself is the group, not a person.
  const speaker =
    !outbound && typeof message.metadata?.participant_name === "string"
      ? message.metadata.participant_name.trim()
      : "";

  if (rendersAsLocation) {
    const label = sharedLocation?.label || "موقع مُرسل";
    const url = sharedLocation?.url ?? null;
    return (
      <View
        style={{
          maxWidth: "84%",
          alignSelf: outbound ? "flex-start" : "flex-end",
          padding: spacing.sm,
          gap: spacing.sm,
          borderRadius: radius.lg + 2,
          borderCurve: "continuous",
          backgroundColor: outbound ? colors.brand : colors.surface,
          borderWidth: outbound ? 0 : 1,
          borderColor: colors.border,
        }}
      >
        {speaker ? (
          <Text numberOfLines={1} style={{ ...type.caption, color: colors.brand, ...rtlText }}>
            {speaker}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole={url ? "link" : "text"}
          accessibilityLabel={
            url ? `${label}، فتح الموقع على الخريطة` : `${label}، تعذّر قراءة الإحداثيات`
          }
          disabled={!url}
          onPress={() => {
            if (!url) return;
            tapFeedback();
            void Linking.openURL(url).catch(() => {});
          }}
          style={({ pressed }) => ({
            minWidth: 210,
            flexDirection: "row-reverse",
            alignItems: "center",
            gap: spacing.md,
            padding: spacing.md,
            borderRadius: radius.md,
            backgroundColor: outbound ? "rgba(255,255,255,0.14)" : colors.brandSoft,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <View
            style={{
              width: 42,
              height: 42,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.full,
              backgroundColor: outbound ? "rgba(255,255,255,0.18)" : colors.surface,
            }}
          >
            <IconSymbol
              name="mappin.and.ellipse"
              color={outbound ? colors.onBrand : colors.brand}
              size={23}
            />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              numberOfLines={2}
              style={{
                ...type.calloutStrong,
                color: outbound ? colors.onBrand : colors.text,
                ...rtlText,
              }}
            >
              {label}
            </Text>
            <Text
              style={{
                ...type.caption,
                color: outbound ? colors.onBrand : url ? colors.brand : colors.textTertiary,
                ...rtlText,
              }}
            >
              {url ? "فتح على الخريطة" : "تعذّر قراءة إحداثيات الموقع"}
            </Text>
          </View>
          {url ? (
            <IconSymbol
              name="chevron.left"
              color={outbound ? colors.onBrand : colors.brand}
              size={18}
            />
          ) : null}
        </Pressable>
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
      {speaker ? (
        <Text
          numberOfLines={1}
          style={{ ...type.caption, color: colors.brand, ...rtlText }}
        >
          {speaker}
        </Text>
      ) : null}

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
});

const keyOfChatItem = (item: ChatItem) =>
  item.kind === "day" ? item.id : item.message.id;

/**
 * Module scope on purpose: neither branch reads anything from the screen, so
 * hoisting it out keeps one stable function identity for the list's whole life.
 */
function renderChatItem({ item }: { item: ChatItem }) {
  return item.kind === "day" ? (
    <DaySeparator label={item.label} />
  ) : (
    <MessageBubble message={item.message} />
  );
}

export default function ConversationScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = useMemo(
    () => (Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "")),
    [params.id],
  );

  // One conversation, one subscription — the thread only cares about its own.
  const typing = useIsTyping(id);

  const conversation = useConversation(id);
  const messageHistory = useConversationMessages(id);
  const bootstrap = useBootstrap();
  const { mutate: markRead } = useMarkConversationRead(id);
  const take = useTakeConversation(id);
  const takeover = useTakeOverConversation(id);
  const conversationActions = useUpdateConversationActions(id);
  const dismissBooking = useDismissBookingRequest(id);
  const [takeoverReason, setTakeoverReason] = useState("");
  const [bookingOpen, setBookingOpen] = useState(false);

  const messages = useMemo(() => {
    const pages = messageHistory.data?.pages;
    if (!pages?.length) return conversation.data?.messages;
    const seen = new Set<string>();
    return [
      ...[...pages].reverse().flatMap((page) => page.messages),
      ...(conversation.data?.messages ?? []),
    ]
      .filter((message) => {
        if (seen.has(message.id)) return false;
        seen.add(message.id);
        return true;
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [conversation.data?.messages, messageHistory.data?.pages]);
  const currentConversation = conversation.data?.conversation;
  const myTeamMemberId = bootstrap.data?.session.teamMemberId ?? null;
  const canMarkRead = Boolean(
    currentConversation?.isGroup ||
      (myTeamMemberId && currentConversation?.assigned_to === myTeamMemberId),
  );
  const chatItems = useMemo(() => buildChatItems(messages ?? []), [messages]);
  // Read from the thread the same way the web inbox does, so a pin or a maps
  // link she already sent fills the booking sheet instead of being retyped.
  // The server sends the same value; this keeps working against older builds
  // of the API that do not.
  const sharedLocation = useMemo(
    () => conversation.data?.sharedLocation ?? findSharedLocation(messages ?? []),
    [conversation.data?.sharedLocation, messages],
  );
  const sharedLocations = useMemo(() => {
    const combined = [
      ...findSharedLocations(messages ?? []),
      ...(conversation.data?.sharedLocation ? [conversation.data.sharedLocation] : []),
    ].sort((left, right) => right.at.localeCompare(left.at));
    const seen = new Set<string>();
    return combined.filter((location) => {
      const key = (location.url || location.value).trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [conversation.data?.sharedLocation, messages]);

  useEffect(() => {
    if (canMarkRead && (currentConversation?.unread_count ?? 0) > 0) markRead();
  }, [canMarkRead, currentConversation?.unread_count, markRead]);

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
  const isGroup = current.isGroup ?? false;
  // A group's `customer_phone` is its jid, so it is never a usable fallback.
  const headerName =
    current.customer_name || (isGroup ? "مجموعة" : current.customer_phone);
  const booking = current.bookingRequest ?? null;
  const isAssignedToMe = Boolean(
    bootstrap.data?.session.teamMemberId &&
      current.assigned_to === bootstrap.data.session.teamMemberId,
  );
  const isAdmin = bootstrap.data?.session.role === "admin";
  const canTakeConversations =
    bootstrap.data?.capabilities.canTakeConversations === true;
  const canUpdateConversation = isAdmin || isAssignedToMe;
  // Nobody replies into someone else's thread directly. Any active employee
  // can explicitly take it over with a reason; only then does the composer
  // appear, preserving one owner and one audit trail.
  //
  // A group is the exception: it belongs to the whole team, so every employee
  // writes in it directly and there is no claim step to pass through first.
  const canReply = isGroup || isAssignedToMe;
  // Replying is not the same as raising a ticket: the booking form needs a
  // customer phone, which a group does not have.
  const canBook = canReply && !isGroup;
  const assignedName =
    bootstrap.data?.agents.find((agent) => agent.id === current.assigned_to)
      ?.fullName ?? "موظفة أخرى";

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={process.env.EXPO_OS === "ios" ? insets.top + 44 : 0}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      {/* The name in the header is the way into the customer's record: an
          employee mid-chat wants her history, not a trip through the calendar
          to find the same person. `title` stays set so the back button on the
          pushed screen still has a short label to fall back to. */}
      <Stack.Screen
        options={{
          title: headerName,
          headerTitle: () => (
            <Pressable
              accessibilityRole="button"
              disabled={isGroup}
              accessibilityLabel={
                isGroup ? headerName : `ملف ${headerName}`
              }
              accessibilityHint="يفتح سجل العميلة وحجوزاتها"
              onPress={() =>
                router.navigate({
                  pathname: "/customer/[phone]",
                  params: {
                    phone: current.customer_phone,
                    name: current.customer_name ?? "",
                  },
                })
              }
              style={({ pressed }) => ({
                alignItems: "center",
                gap: 1,
                paddingHorizontal: spacing.sm,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                numberOfLines={1}
                style={{ ...type.headline, color: colors.text, ...rtlText }}
              >
                {headerName}
              </Text>
              {/* A group is not a customer: there is no record behind it, and
                  its jid would open somebody else's timeline or none at all. */}
              {isGroup ? (
                <View
                  style={{
                    flexDirection: "row-reverse",
                    alignItems: "center",
                    gap: spacing.xs,
                  }}
                >
                  <IconSymbol name="person.2" size={11} color={colors.textTertiary} />
                  <Text style={{ ...type.caption, color: colors.textTertiary }}>
                    مجموعة واتساب
                  </Text>
                </View>
              ) : (
                <View
                  style={{
                    flexDirection: "row-reverse",
                    alignItems: "center",
                    gap: spacing.xs,
                  }}
                >
                  <IconSymbol name="person.crop.circle" size={11} color={colors.brand} />
                  <Text style={{ ...type.caption, color: colors.brand }}>
                    عرض الملف
                  </Text>
                </View>
              )}
            </Pressable>
          ),
        }}
      />

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
        {/* A group has no CS lifecycle: nobody claims it, the assistant never
            replies in it, and no one is waiting on it — so the status would
            read as stale on every group, forever.

            An unclaimed thread has no lifecycle yet either: "جاري المحادثة"
            over the استلام المحادثة button contradicts the button itself. */}
        {isGroup ? null : current.assigned_to ? (
          <Badge label={csStatusLabel[current.csStatus]} tone={csStatusTone[current.csStatus]} />
        ) : (
          <Badge tone="warning" icon="person.crop.circle" label="غير مستلمة" />
        )}
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
          {isGroup ? "" : current.customer_phone}
        </Text>
        {/* Confirming an appointment is the most common thing an employee does
            mid-chat, so it sits in the pinned strip rather than behind the
            composer's attachment menu — reachable whether or not the assistant
            collected a booking first.

            Not on a group, though: a booking is raised against the customer's
            phone, and a group's `customer_phone` is its jid. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="تأكيد الحجز وطلب السائق"
          accessibilityHint="يفتح نموذج حفظ الموعد"
          disabled={!canBook}
          onPress={() => setBookingOpen(true)}
          style={({ pressed }) => ({
            flexDirection: "row-reverse",
            alignItems: "center",
            gap: spacing.xs,
            minHeight: hitSize.min - 8,
            paddingHorizontal: spacing.sm + 2,
            borderRadius: radius.full,
            backgroundColor: pressed ? colors.brand : colors.brandSoft,
            opacity: canBook ? 1 : 0.45,
          })}
        >
          {({ pressed }) => (
            <>
              <IconSymbol
                name="calendar"
                size={14}
                color={pressed ? colors.onBrand : colors.onBrandSoft}
              />
              <Text
                style={{
                  ...type.caption,
                  color: pressed ? colors.onBrand : colors.onBrandSoft,
                  ...rtlText,
                }}
              >
                حجز
              </Text>
            </>
          )}
        </Pressable>
        <ConversationActionsButton
          conversationId={id}
          csStatus={current.csStatus}
          bookingStage={current.bookingStage}
          bookingReceipt={current.bookingReceipt ?? null}
          reminder={current.reminderConfirmation}
          labelIds={current.labelIds}
          labels={bootstrap.data?.labels ?? []}
          bookingStages={bootstrap.data?.bookingStages ?? []}
          agents={bootstrap.data?.agents ?? []}
          assignedTo={current.assigned_to}
          myTeamMemberId={bootstrap.data?.session.teamMemberId ?? null}
          isAdmin={Boolean(isAdmin)}
          section={current.section}
          routedTo={current.routedTo}
          canEdit={canUpdateConversation}
          pending={conversationActions.isPending}
          error={conversationActions.error?.message ?? null}
          onSave={(input, onSuccess) =>
            conversationActions.mutate(input, { onSuccess })
          }
        />
      </View>

      {/* The assistant collected the details; a human still owns the date. The
          banner pins to the top of the thread, like the web inbox, so it is the
          first thing seen on opening the chat rather than something to scroll
          back for. */}
      {booking ? (
        <View
          style={{
            gap: spacing.sm,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            backgroundColor: colors.brandSoft,
          }}
        >
          <View
            style={{
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <IconSymbol name="calendar" color={colors.onBrandSoft} size={17} />
            <Text
              style={{
                flex: 1,
                ...type.subheadStrong,
                color: colors.onBrandSoft,
                ...rtlText,
              }}
            >
              جمع المساعد تفاصيل حجز
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="تجاهل طلب الحجز"
              disabled={!canReply || dismissBooking.isPending}
              onPress={() => dismissBooking.mutate()}
              hitSlop={spacing.sm}
              style={({ pressed }) => ({
                width: hitSize.min - 12,
                height: hitSize.min - 12,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                opacity: !canReply || pressed || dismissBooking.isPending ? 0.5 : 1,
              })}
            >
              <IconSymbol name="xmark" color={colors.onBrandSoft} size={15} />
            </Pressable>
          </View>

          <Text
            selectable
            style={{ ...type.footnote, color: colors.onBrandSoft, ...rtlText }}
          >
            {[
              booking.service ? `الخدمة: ${booking.service}` : "",
              booking.time ? `الموعد: ${booking.time}` : "",
              booking.location ? `الموقع: ${booking.location}` : "",
            ]
              .filter(Boolean)
              .join(" · ") || booking.summary}
          </Text>

          <PrimaryButton
            label="تأكيد الحجز وطلب السائق"
            icon="checkmark.circle"
            disabled={!canReply}
            onPress={() => setBookingOpen(true)}
          />
          {dismissBooking.error ? (
            <InlineAlert message={dismissBooking.error.message} />
          ) : null}
        </View>
      ) : null}

      <BookingSheet
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        conversationId={id}
        booking={booking}
        sharedLocation={sharedLocation}
        sharedLocations={sharedLocations}
      />

      <FlatList
        // Inverted so new messages land at the bottom without manual scrolling.
        inverted
        // Bounded on purpose: React Native defaults `flexShrink` to 0, so
        // without this the list sizes to its full content height in this
        // column and a long thread pushes the action bar past the parent.
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        data={chatItems}
        keyExtractor={keyOfChatItem}
        renderItem={renderChatItem}
        // A long thread is the one list here that really can reach hundreds of
        // rows, so it gets the tightest window of any list in the app.
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={9}
        removeClippedSubviews={process.env.EXPO_OS === "android"}
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.sm + 2,
          flexGrow: 1,
          justifyContent: "flex-start",
        }}
        keyboardDismissMode={process.env.EXPO_OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.25}
        onEndReached={() => {
          if (messageHistory.hasNextPage && !messageHistory.isFetchingNextPage) {
            void messageHistory.fetchNextPage();
          }
        }}
        ListFooterComponent={
          messageHistory.isFetchingNextPage ? (
            <Text
              style={{
                paddingVertical: spacing.md,
                ...type.footnote,
                color: colors.textTertiary,
                ...rtlText,
                textAlign: "center",
              }}
            >
              جارٍ تحميل الرسائل الأقدم…
            </Text>
          ) : messageHistory.isFetchNextPageError ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void messageHistory.fetchNextPage()}
              style={{ paddingVertical: spacing.md }}
            >
              <Text
                style={{
                  ...type.footnote,
                  color: colors.danger,
                  ...rtlText,
                  textAlign: "center",
                }}
              >
                تعذّر تحميل الرسائل الأقدم — اضغطي للمحاولة
              </Text>
            </Pressable>
          ) : null
        }
      />

      {typing ? (
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
              canTakeConversations ? (
                <PrimaryButton
                  testID="take-conversation"
                  label="استلام المحادثة"
                  loadingLabel="جارٍ استلام المحادثة…"
                  icon="checkmark.circle"
                  loading={take.isPending}
                  onPress={() => take.mutate()}
                />
              ) : (
                <InlineAlert
                  tone="warning"
                  message="هذا الحساب غير مرتبط بعضوية فريق نشطة، لذلك لا يمكنه استلام المحادثات. تواصلي مع الإدارة لتصحيح الحساب."
                />
              )
            ) : canTakeConversations ? (
              // Any active employee may rescue a colleague's conversation, but
              // not silently: the reason appears in the owner report.
              <View style={{ gap: spacing.sm }}>
                <InlineAlert
                  tone="warning"
                  message={`هذه المحادثة مستلمة من ${assignedName}. إذا كانت غير متاحة يمكنك استلام المحادثة بعد كتابة السبب.`}
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
                message="هذا الحساب غير مرتبط بعضوية فريق نشطة، لذلك لا يمكنه استلام المحادثات."
              />
            )}
          </>
        ) : (
          <Composer
            conversationId={id}
            templateOnly={!isGroup && (messages?.length ?? 0) === 0}
          />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
