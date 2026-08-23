import { Link, Stack } from "expo-router";
import { useDeferredValue, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";

import {
  ConversationFiltersSheet,
  activeFilterCount,
} from "@/components/inbox/conversation-filters-sheet";
import { PrimaryButton } from "@/components/primary-button";
import { EmptyState, ErrorState, InlineAlert } from "@/components/screen-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge, CountBadge } from "@/components/ui/badge";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { SkeletonList } from "@/components/ui/skeleton";
import { TypingIndicator } from "@/components/typing-indicator";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { bookingStageLabel, csStatusLabel, relativeTimeLabel } from "@/lib/format";
import { EMPTY_CONVERSATION_FILTERS, useBootstrap, useConversations } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import { useInboxLive } from "@/providers/inbox-live-provider";
import type {
  ConversationFilters,
  ConversationSummary,
  InboxView,
} from "@/types/api";

const views: SegmentOption<InboxView>[] = [
  { value: "new", label: "جديد" },
  { value: "mine", label: "محادثاتي" },
  { value: "unassigned", label: "غير مستلمة" },
  { value: "danger", label: "خطر" },
];

function ConversationRow({
  conversation,
  typing,
}: {
  conversation: ConversationSummary;
  typing: boolean;
}) {
  const { colors } = useTheme();

  const overdue = conversation.dangerMinutes !== null && conversation.dangerMinutes >= 6;
  const unread = conversation.unread_count ?? 0;
  const displayName = conversation.customer_name || conversation.customer_phone;

  return (
    // `asChild` keeps the card a real View tree. A plain <Link> renders its
    // children inside a <Text>, which drops the card's background and flex row.
    <Link href={{ pathname: "/inbox/[id]", params: { id: conversation.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`محادثة ${displayName}${unread ? `، ${unread} رسائل غير مقروءة` : ""}${
          overdue ? "، تنتظر ردًا" : ""
        }`}
      >
        {({ pressed }) => (
          <View
            style={{
              flexDirection: "row-reverse",
              gap: spacing.md,
              padding: spacing.lg,
              borderRadius: radius.xl,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: overdue ? colors.danger : colors.border,
              backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
              boxShadow: "0 1px 2px rgba(24, 33, 77, 0.05)",
            }}
          >
            <Avatar name={conversation.customer_name} seed={conversation.customer_phone} />

            <View style={{ flex: 1, gap: spacing.xs + 2 }}>
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
                    ...type.headline,
                    color: colors.text,
                    ...rtlText,
                  }}
                >
                  {displayName}
                </Text>
                <Text
                  style={{
                    ...type.caption,
                    color: overdue ? colors.danger : colors.textTertiary,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {relativeTimeLabel(conversation.last_message_at)}
                </Text>
              </View>

              {typing ? (
                <TypingIndicator />
              ) : (
                <Text
                  numberOfLines={1}
                  style={{
                    ...type.footnote,
                    color: colors.textSecondary,
                    fontVariant: ["tabular-nums"],
                    ...rtlText,
                  }}
                >
                  {conversation.customer_phone}
                </Text>
              )}

              <View
                style={{
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: spacing.xs + 2,
                }}
              >
                <CountBadge count={unread} />
                {overdue ? <Badge tone="danger" icon="hourglass" label="تنتظر ردًا" /> : null}
                {!conversation.assigned_to ? (
                  <Badge tone="warning" icon="person.crop.circle" label="غير مستلمة" />
                ) : null}
                {conversation.bookingStage ? (
                  <Badge tone="neutral" label={bookingStageLabel[conversation.bookingStage]} />
                ) : null}
              </View>
            </View>
          </View>
        )}
      </Pressable>
    </Link>
  );
}

export default function InboxScreen() {
  const { colors } = useTheme();
  const { isTyping } = useInboxLive();
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

  return (
    <>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: "بحث بالاسم أو رقم الجوال",
            onChangeText: (event) => setSearch(event.nativeEvent.text),
            onClose: () => setSearch(""),
            hideWhenScrolling: false,
          },
        }}
      />

      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <Animated.View
            entering={FadeIn.delay(Math.min(index, 8) * 24).duration(200)}
            exiting={FadeOut.duration(140)}
            layout={LinearTransition.duration(220)}
          >
            <ConversationRow conversation={item} typing={isTyping(item.id)} />
          </Animated.View>
        )}
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          flexGrow: 1,
        }}
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View style={{ gap: spacing.md, paddingBottom: spacing.xs }}>
            {/* The four views, plus the way into everything the web keeps in
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
              detail="لا توجد محادثات مطابقة لهذا الفلتر حاليًا."
            />
          )
        }
        ListFooterComponent={
          items.length ? (
            <View
              style={{
                gap: spacing.sm,
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
