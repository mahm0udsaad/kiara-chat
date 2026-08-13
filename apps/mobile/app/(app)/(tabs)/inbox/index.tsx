import { Link, Stack } from "expo-router";
import { useDeferredValue, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";

import { EmptyState, ErrorState } from "@/components/screen-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge, CountBadge } from "@/components/ui/badge";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Segmented, type SegmentOption } from "@/components/ui/segmented";
import { SkeletonList } from "@/components/ui/skeleton";
import { TypingIndicator } from "@/components/typing-indicator";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { bookingStageLabel, relativeTimeLabel } from "@/lib/format";
import { useConversations } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import { useInboxLive } from "@/providers/inbox-live-provider";
import type { ConversationSummary, InboxView } from "@/types/api";

const filters: SegmentOption<InboxView>[] = [
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
  // Keeps typing responsive — the request tracks a frame behind the keystroke.
  const deferredSearch = useDeferredValue(search);
  const conversations = useConversations(view, deferredSearch.trim());

  const counts = conversations.data?.counts;
  const items = conversations.data?.conversations.items ?? [];
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
            <Segmented
              accessibilityLabel="تصفية المحادثات"
              options={filters.map((filter) => ({
                ...filter,
                count: counts?.[filter.value],
              }))}
              value={view}
              onChange={setView}
              layout="scroll"
            />
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
          conversations.data?.conversations.hasMore ? (
            <View
              style={{
                flexDirection: "row-reverse",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.sm,
                paddingVertical: spacing.lg,
              }}
            >
              <IconSymbol name="info.circle" color={colors.textTertiary} size={15} />
              <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
                يتم عرض أحدث {conversations.data.conversations.items.length} محادثة
              </Text>
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
    </>
  );
}
