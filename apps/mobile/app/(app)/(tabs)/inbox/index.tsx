import { Link, Stack } from "expo-router";
import { memo, useCallback, useDeferredValue, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
} from "react-native-reanimated";

import {
  ConversationFiltersSheet,
  HANDLING_LABEL,
  activeFilterCount,
} from "@/components/inbox/conversation-filters-sheet";
import { PrimaryButton } from "@/components/primary-button";
import { EmptyState, ErrorState, InlineAlert } from "@/components/screen-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge, CountBadge, type BadgeTone } from "@/components/ui/badge";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { SkeletonList } from "@/components/ui/skeleton";
import { TypingIndicator } from "@/components/typing-indicator";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  bookingStageLabel,
  conversationListTimeLabel,
  csStatusLabel,
  csStatusTone,
} from "@/lib/format";
import { EMPTY_CONVERSATION_FILTERS, useBootstrap, useConversations } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import { useIsTyping } from "@/providers/inbox-live-provider";
import type {
  ConversationFilters,
  ConversationSummary,
  InboxView,
  LabelColor,
} from "@/types/api";

const views: SegmentOption<InboxView>[] = [
  { value: "new", label: "جديد" },
  { value: "mine", label: "محادثاتي" },
  { value: "unassigned", label: "غير مستلمة" },
  { value: "specialists", label: "الأخصائيات" },
  { value: "drivers", label: "السائقون" },
  { value: "groups", label: "المجموعات" },
  { value: "danger", label: "خطر" },
];

const keyOfConversation = (item: ConversationSummary) => item.id;

/** A readable fallback for media messages that have no caption of their own. */
const MEDIA_PREVIEW: Record<string, { label: string; icon: IconName }> = {
  voice: { label: "رسالة صوتية", icon: "mic" },
  audio: { label: "مقطع صوتي", icon: "waveform" },
  image: { label: "صورة", icon: "camera" },
  video: { label: "فيديو", icon: "photo" },
  document: { label: "ملف", icon: "doc" },
  file: { label: "ملف", icon: "doc" },
  sticker: { label: "ملصق", icon: "photo" },
  location: { label: "موقع", icon: "mappin.and.ellipse" },
  locationMessage: { label: "موقع", icon: "mappin.and.ellipse" },
  liveLocationMessage: { label: "موقع مباشر", icon: "mappin.and.ellipse" },
};

const LABEL_TONE: Record<LabelColor, BadgeTone> = {
  slate: "neutral",
  red: "danger",
  amber: "warning",
  emerald: "success",
  blue: "info",
  indigo: "brand",
  fuchsia: "brand",
  rose: "danger",
};

/** WhatsApp-style delivery ticks for the latest outbound message. */
function DeliveryTicks({ status }: { status: string | null }) {
  const { colors } = useTheme();

  if (status === "failed") {
    return <IconSymbol name="exclamationmark.circle" color={colors.danger} size={14} />;
  }
  if (status === "queued") {
    return <IconSymbol name="clock" color={colors.textTertiary} size={13} />;
  }

  const hasSecondTick = status === "delivered" || status === "read" || status === "played";
  const tint = status === "read" || status === "played" ? colors.brand : colors.textTertiary;

  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <IconSymbol name="checkmark" color={tint} size={13} />
      {hasSecondTick ? (
        <View style={{ marginStart: -7 }}>
          <IconSymbol name="checkmark" color={tint} size={13} />
        </View>
      ) : null}
    </View>
  );
}

const ConversationRow = memo(function ConversationRow({
  conversation,
  staff,
}: {
  conversation: ConversationSummary;
  /** Which roster tab this row is being listed under, if any. */
  staff: "specialist" | "driver" | null;
}) {
  const { colors } = useTheme();
  // Subscribed here rather than passed down, so a keystroke in one chat wakes
  // that chat's row and leaves the other fifteen on screen untouched.
  const typing = useIsTyping(conversation.id);

  const overdue = conversation.dangerMinutes !== null && conversation.dangerMinutes >= 6;
  const unread = conversation.unread_count ?? 0;
  const isGroup = conversation.isGroup ?? false;
  // A group's "phone" is its jid, which is not something to show anybody — an
  // unnamed group says so instead.
  const displayName =
    conversation.customer_name || (isGroup ? "مجموعة" : conversation.customer_phone);
  const lastMessage = conversation.lastMessage ?? null;
  const mediaPreview = lastMessage ? MEDIA_PREVIEW[lastMessage.messageType] : undefined;
  // Prefer a real caption when media has one. Unknown text-bearing message
  // types (for example reactions) remain readable instead of exposing an
  // internal provider type to the employee.
  const previewBody = lastMessage
    ? lastMessage.text || mediaPreview?.label || ""
    : isGroup
      ? ""
      : conversation.customer_phone;
  // In a group every line is from someone different, so the row names them —
  // without it the preview reads as one person talking to themselves.
  const speaker = isGroup ? lastMessage?.participantName?.trim() : null;
  const previewText = speaker ? `${speaker}: ${previewBody}` : previewBody;

  return (
    // `asChild` keeps the row a real View tree. A plain <Link> renders its
    // children inside a <Text>, which drops the flex layout.
    <Link href={{ pathname: "/inbox/[id]", params: { id: conversation.id } }} asChild>
      <Pressable
        testID={`conversation-row-${conversation.id}`}
        accessibilityRole="button"
        accessibilityLabel={`محادثة ${displayName}${unread ? `، ${unread} رسائل غير مقروءة` : ""}${
          overdue ? "، تنتظر ردًا" : ""
        }`}
      >
        {({ pressed }) => (
          <View
            style={{
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: spacing.md,
              minHeight: 80,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
            }}
          >
            <Avatar
              name={displayName}
              seed={conversation.customer_phone}
              size={56}
            />

            <View style={{ flex: 1, gap: spacing.xs }}>
              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.sm,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    ...type.bodyStrong,
                    color: colors.text,
                    ...rtlText,
                  }}
                >
                  {displayName}
                </Text>
                <Text
                  style={{
                    ...type.caption,
                    fontWeight: "400",
                    color: overdue
                      ? colors.danger
                      : unread
                        ? colors.brand
                        : colors.textTertiary,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {conversationListTimeLabel(lastMessage?.at ?? conversation.last_message_at)}
                </Text>
              </View>

              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.xs,
                  minHeight: 22,
                }}
              >
                {typing ? (
                  <TypingIndicator />
                ) : (
                  <>
                    {lastMessage?.role === "agent" ? (
                      <DeliveryTicks status={lastMessage.deliveryStatus} />
                    ) : null}
                    {mediaPreview ? (
                      <IconSymbol
                        name={mediaPreview.icon}
                        color={colors.textTertiary}
                        size={15}
                      />
                    ) : null}
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        ...type.footnote,
                        color: unread ? colors.text : colors.textSecondary,
                        ...rtlText,
                      }}
                    >
                      {previewText}
                    </Text>
                  </>
                )}

                {unread ? (
                  <CountBadge count={unread} />
                ) : null}
              </View>

              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: spacing.xs,
                  paddingTop: spacing.xs,
                }}
              >
                <Badge
                  label={csStatusLabel[conversation.csStatus]}
                  tone={csStatusTone[conversation.csStatus]}
                />
                {conversation.bookingStage ? (
                  <Badge
                    label={bookingStageLabel[conversation.bookingStage]}
                    tone="neutral"
                  />
                ) : null}
                {isGroup ? (
                  // Groups are nobody's ticket, so the unclaimed warning below
                  // would be permanent and meaningless on every one of them.
                  <Badge tone="brand" icon="person.2" label="مجموعة" />
                ) : staff === "specialist" ? (
                  <Badge tone="brand" icon="sparkles" label="أخصائية" />
                ) : staff === "driver" ? (
                  <Badge tone="brand" icon="car" label="سائق" />
                ) : !conversation.assigned_to ? (
                  <Badge tone="warning" icon="person.crop.circle" label="غير مستلمة" />
                ) : null}
                {overdue ? (
                  <Badge tone="danger" icon="hourglass" label="تنتظر ردًا" />
                ) : null}
                {/* Otherwise the thread reads as ignored: the reply exists,
                    it was just typed on the phone and never recorded here. */}
                {conversation.handledOnWhatsApp ? (
                  <Badge tone="info" icon="message" label="رُدّ من واتساب" />
                ) : null}
                {conversation.labels?.map((label) => (
                  <Badge
                    key={label.id}
                    label={label.name}
                    tone={LABEL_TONE[label.color]}
                  />
                ))}
              </View>
            </View>

            {/* Keep the divider under the text, rather than cutting through
                the avatar column, like a native messaging list. */}
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                bottom: 0,
                left: spacing.lg,
                right: spacing.lg + 56 + spacing.md,
                height: 1,
                backgroundColor: colors.border,
              }}
            />
          </View>
        )}
      </Pressable>
    </Link>
  );
});

export default function InboxScreen() {
  const { colors } = useTheme();
  const android = process.env.EXPO_OS === "android";
  const [view, setView] = useState<InboxView>("new");
  const [search, setSearch] = useState("");
  // The web inbox's status/section/label dropdowns, folded into one sheet.
  const [filters, setFilters] = useState<ConversationFilters>(
    EMPTY_CONVERSATION_FILTERS,
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Keeps typing responsive — the request tracks a frame behind the keystroke.
  const deferredSearch = useDeferredValue(search);
  const conversations = useConversations(view, deferredSearch.trim(), { filters });
  const bootstrapLabels = useBootstrap().data?.labels;
  const labels = useMemo(() => bootstrapLabels ?? [], [bootstrapLabels]);
  const activeFilters = activeFilterCount(filters);

  // Chips for what is currently on, each one its own way back out.
  const filterChips = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (filters.status) {
      chips.push({
        key: "status",
        label: csStatusLabel[filters.status],
        clear: () => setFilters((current) => ({ ...current, status: null })),
      });
    }
    if (filters.section) {
      chips.push({
        key: "section",
        label: filters.section === "orders" ? "قسم الطلبات" : "قسم الردود",
        clear: () => setFilters((current) => ({ ...current, section: null })),
      });
    }
    if (filters.labelId) {
      const name =
        labels.find((label) => label.id === filters.labelId)?.name ?? "تصنيف";
      chips.push({
        key: "label",
        label: name,
        clear: () => setFilters((current) => ({ ...current, labelId: null })),
      });
    }
    if (filters.bookingStage) {
      chips.push({
        key: "stage",
        label: bookingStageLabel[filters.bookingStage],
        clear: () => setFilters((current) => ({ ...current, bookingStage: null })),
      });
    }
    if (filters.handling) {
      chips.push({
        key: "handling",
        label: HANDLING_LABEL[filters.handling],
        clear: () => setFilters((current) => ({ ...current, handling: null })),
      });
    }
    return chips;
  }, [filters, labels]);

  const firstPage = conversations.data?.pages[0];
  const counts = firstPage?.counts;
  const items = useMemo(() => {
    const seen = new Set<string>();
    return (conversations.data?.pages ?? [])
      .flatMap((page) => page.conversations.items)
      .filter((conversation) => {
        if (seen.has(conversation.id)) return false;
        seen.add(conversation.id);
        return true;
      });
  }, [conversations.data?.pages]);
  const total = firstPage?.conversations.total ?? items.length;
  const showSkeleton = conversations.isLoading && items.length === 0;
  const staffView =
    view === "specialists" ? "specialist" : view === "drivers" ? "driver" : null;

  /**
   * Hoisted so the memo on ConversationRow actually holds — an arrow declared
   * in JSX is a new function on every render, which makes every row prop
   * "changed" no matter what memo does.
   *
   * The rows keep their entrance fade but no longer carry
   * `layout={LinearTransition}`: a layout transition re-measures every row on
   * every list change, and this list changes on a 15-second poll, so the
   * animation was running constantly to express a reorder nobody asked to see.
   */
  const renderRow = useCallback(
    ({ item, index }: { item: ConversationSummary; index: number }) => (
      <Animated.View
        entering={FadeIn.delay(Math.min(index, 8) * 24).duration(200)}
        exiting={FadeOut.duration(140)}
      >
        <ConversationRow conversation={item} staff={staffView} />
      </Animated.View>
    ),
    [staffView],
  );

  return (
    <>
      <Stack.Screen
        options={{
          // The native-stack header search control is iOS-only. Android gets
          // the always-visible field in the list header below.
          headerSearchBarOptions: android
            ? undefined
            : {
                placeholder: "بحث بالاسم أو رقم الجوال",
                onChangeText: (event) => setSearch(event.nativeEvent.text),
                onClose: () => setSearch(""),
                hideWhenScrolling: false,
              },
        }}
      />

      <FlatList
        testID="conversation-list"
        contentInsetAdjustmentBehavior="automatic"
        data={items}
        keyExtractor={keyOfConversation}
        renderItem={renderRow}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews={process.env.EXPO_OS === "android"}
        contentContainerStyle={{
          paddingBottom: spacing.lg,
          flexGrow: 1,
        }}
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View
            style={{
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.lg,
              paddingBottom: spacing.md,
            }}
          >
            {android ? (
              <View
                style={{
                  minHeight: hitSize.comfortable,
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.lg,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                }}
              >
                <IconSymbol
                  name="magnifyingglass"
                  color={colors.textTertiary}
                  size={18}
                />
                <TextInput
                  testID="conversation-search"
                  accessibilityLabel="بحث في المحادثات"
                  placeholder="بحث بالاسم أو رقم الجوال"
                  placeholderTextColor={colors.textTertiary}
                  value={search}
                  onChangeText={setSearch}
                  returnKeyType="search"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    flex: 1,
                    minHeight: hitSize.comfortable,
                    ...type.body,
                    color: colors.text,
                    ...rtlText,
                  }}
                />
                {search ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="مسح البحث"
                    hitSlop={8}
                    onPress={() => setSearch("")}
                    style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
                  >
                    <IconSymbol
                      name="xmark"
                      color={colors.textTertiary}
                      size={19}
                    />
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* The inbox views, plus the way into everything the web keeps in
                dropdowns next to its search box. */}
            <View
              style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}
            >
              <View style={{ flex: 1 }}>
                <Segmented
                  accessibilityLabel="تصفية المحادثات"
                  options={views.map((option) => ({
                    ...option,
                    count: counts?.[option.value],
                  }))}
                  value={view}
                  onChange={setView}
                  layout="scroll"
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  activeFilters
                    ? `تصفية متقدمة، ${activeFilters} مطبّقة`
                    : "تصفية متقدمة"
                }
                onPress={() => setFiltersOpen(true)}
                style={({ pressed }) => ({
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  gap: spacing.xs,
                  minHeight: hitSize.min,
                  paddingHorizontal: spacing.md,
                  borderRadius: radius.full,
                  borderWidth: activeFilters ? 1.5 : 1,
                  borderColor: activeFilters ? colors.brand : colors.border,
                  backgroundColor: activeFilters
                    ? colors.brandSoft
                    : pressed
                      ? colors.surfaceSunken
                      : colors.surface,
                })}
              >
                <IconSymbol
                  name="slider.horizontal.3"
                  color={activeFilters ? colors.brand : colors.textSecondary}
                  size={17}
                />
                {activeFilters ? (
                  <Text
                    style={{
                      ...type.caption,
                      color: colors.onBrandSoft,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {activeFilters}
                  </Text>
                ) : null}
              </Pressable>
            </View>

            {filterChips.length ? (
              <View
                style={{
                  flexDirection: "row-reverse",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: spacing.sm,
                }}
              >
                {filterChips.map((chip) => (
                  <Pressable
                    key={chip.key}
                    accessibilityRole="button"
                    accessibilityLabel={`إزالة تصفية ${chip.label}`}
                    onPress={chip.clear}
                    style={({ pressed }) => ({
                      flexDirection: "row-reverse",
                      alignItems: "center",
                      gap: spacing.xs,
                      minHeight: hitSize.min - 10,
                      paddingHorizontal: spacing.md,
                      borderRadius: radius.full,
                      backgroundColor: colors.brandSoft,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Text style={{ ...type.caption, color: colors.onBrandSoft, ...rtlText }}>
                      {chip.label}
                    </Text>
                    <IconSymbol name="xmark" color={colors.onBrandSoft} size={11} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {showSkeleton ? <SkeletonList count={6} /> : null}
          </View>
        }
        ListEmptyComponent={
          showSkeleton ? null : conversations.isError ? (
            <ErrorState
              message={conversations.error.message}
              onRetry={() => void conversations.refetch()}
            />
          ) : deferredSearch.trim() ? (
            <EmptyState
              icon="magnifyingglass"
              title="لا توجد نتائج"
              detail={`لم نعثر على محادثة تطابق «${deferredSearch.trim()}».`}
            />
          ) : (
            <EmptyState
              icon="tray"
              title="لا توجد محادثات"
              detail={
                view === "specialists"
                  ? "لا توجد محادثات لأرقام الأخصائيات المحفوظة."
                  : view === "drivers"
                    ? "لا توجد محادثات لأرقام السائقين المحفوظة."
                    : view === "groups"
                      ? "لم تصل رسائل من أي مجموعة بعد."
                      : "لا توجد محادثات مطابقة لهذا الفلتر حاليًا."
              }
            />
          )
        }
        ListFooterComponent={
          items.length ? (
            <View
              style={{
                gap: spacing.sm,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.lg,
              }}
            >
              {conversations.isFetchNextPageError ? (
                <InlineAlert message={conversations.error.message} />
              ) : null}
              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: spacing.sm,
                }}
              >
                <IconSymbol name="info.circle" color={colors.textTertiary} size={15} />
                <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
                  يتم عرض {items.length} من {total} محادثة
                </Text>
              </View>
              {conversations.hasNextPage ? (
                <PrimaryButton
                  testID="conversations-load-more"
                  label="عرض المزيد"
                  icon="plus"
                  variant="tinted"
                  loading={conversations.isFetchingNextPage}
                  onPress={() => void conversations.fetchNextPage()}
                />
              ) : null}
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={conversations.isRefetching}
            onRefresh={() => void conversations.refetch()}
            tintColor={colors.brand}
          />
        }
      />

      <ConversationFiltersSheet
        open={filtersOpen}
        filters={filters}
        labels={labels}
        onClose={() => setFiltersOpen(false)}
        onChange={setFilters}
      />
    </>
  );
}
