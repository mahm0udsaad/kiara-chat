import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorState, LoadingScreen } from "@/components/screen-state";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { tapFeedback } from "@/lib/haptics";
import { useCatalog } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { CatalogItem } from "@/types/api";

/**
 * The spa's services and packages, for dropping an explanation into a reply —
 * the phone's counterpart to the web composer's sheet.
 *
 * Picking fills the composer rather than sending: the wording is still the
 * employee's. When the service has a photo it rides along as a staged
 * attachment, which is why `onPick` hands back the item and not just its text.
 */
export function CatalogSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (item: CatalogItem, text: string) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const catalog = useCatalog(open);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  const items = useMemo(() => catalog.data?.items ?? [], [catalog.data]);

  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category))].sort((a, b) => a.localeCompare(b, "ar")),
    [items],
  );

  const filtered = useMemo(() => {
    const needle = query.trim();
    return items.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!needle) return true;
      return item.name.includes(needle) || item.description.includes(needle);
    });
  }, [items, query, category]);

  return (
    <Modal
      visible={open}
      onRequestClose={onClose}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            flexDirection: "row-reverse",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing.md,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.lg,
            paddingBottom: spacing.md,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            backgroundColor: colors.surface,
          }}
        >
          <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>الباقات والخدمات</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إغلاق"
            onPress={onClose}
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
            <IconSymbol name="xmark" color={colors.textSecondary} size={18} />
          </Pressable>
        </View>

        <View
          style={{
            gap: spacing.sm,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            backgroundColor: colors.surface,
          }}
        >
          <View
            style={{
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: spacing.sm,
              minHeight: hitSize.min,
              paddingHorizontal: spacing.md,
              borderRadius: radius.md,
              borderCurve: "continuous",
              backgroundColor: colors.surfaceSunken,
            }}
          >
            <IconSymbol name="magnifyingglass" color={colors.textTertiary} size={17} />
            <TextInput
              accessibilityLabel="بحث في الباقات"
              placeholder="ابحثي عن خدمة أو باقة…"
              placeholderTextColor={colors.textTertiary}
              value={query}
              onChangeText={setQuery}
              style={{ flex: 1, ...type.callout, color: colors.text, ...rtlText }}
            />
          </View>

          {categories.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                flexDirection: "row-reverse",
                gap: spacing.xs + 2,
                paddingVertical: spacing.xs,
              }}
            >
              <Chip active={category === "all"} onPress={() => setCategory("all")} label="الكل" />
              {categories.map((name) => (
                <Chip
                  key={name}
                  active={category === name}
                  onPress={() => setCategory(name)}
                  label={name}
                />
              ))}
            </ScrollView>
          ) : null}
        </View>

        {catalog.isLoading ? (
          <LoadingScreen label="جارٍ تحميل الباقات…" />
        ) : catalog.isError ? (
          <ErrorState
            title="تعذّر تحميل الباقات"
            message={catalog.error?.message ?? "حاولي مرة أخرى"}
            onRetry={() => void catalog.refetch()}
          />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: spacing.lg,
              paddingBottom: spacing.lg + insets.bottom,
              gap: spacing.sm,
            }}
            ListEmptyComponent={
              <Text
                style={{
                  ...type.callout,
                  color: colors.textTertiary,
                  textAlign: "center",
                  paddingVertical: spacing["3xl"],
                }}
              >
                {items.length ? "لا نتائج مطابقة." : "لا توجد باقات بعد."}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.name}
                onPress={() => {
                  tapFeedback();
                  onPick(item, formatItem(item));
                  onClose();
                }}
                style={({ pressed }) => ({
                  flexDirection: "row-reverse",
                  alignItems: "flex-start",
                  gap: spacing.md,
                  padding: spacing.md,
                  borderRadius: radius.lg,
                  borderCurve: "continuous",
                  borderWidth: 1,
                  borderColor: pressed ? colors.brand : colors.border,
                  backgroundColor: pressed ? colors.brandSoft : colors.surface,
                })}
              >
                {item.imageUrl ? (
                  <Image
                    source={item.imageUrl}
                    contentFit="cover"
                    transition={120}
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: radius.md,
                      backgroundColor: colors.surfaceSunken,
                    }}
                  />
                ) : (
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radius.md,
                      backgroundColor: colors.surfaceSunken,
                    }}
                  >
                    <IconSymbol name="sparkles" color={colors.textTertiary} size={20} />
                  </View>
                )}

                <View style={{ flex: 1, gap: spacing.xs }}>
                  <View
                    style={{
                      flexDirection: "row-reverse",
                      alignItems: "flex-start",
                      gap: spacing.sm,
                    }}
                  >
                    <Text
                      style={{ flex: 1, ...type.calloutStrong, color: colors.text, ...rtlText }}
                    >
                      {item.name}
                    </Text>
                    {item.price != null ? (
                      <Text
                        style={{
                          ...type.caption,
                          color: colors.brand,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {item.price} ر.س
                      </Text>
                    ) : null}
                  </View>
                  {item.description ? (
                    <Text
                      numberOfLines={2}
                      style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}
                    >
                      {item.description}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

/** Mirrors the web sheet's `formatItem`, so both surfaces send the same text. */
function formatItem(item: CatalogItem): string {
  const price = item.price == null ? "" : ` — ${item.price} ر.س`;
  return item.description
    ? `${item.name}${price}\n${item.description}`
    : `${item.name}${price}`;
}

function Chip({
  active,
  onPress,
  label,
}: {
  active: boolean;
  onPress: () => void;
  label: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: 32,
        justifyContent: "center",
        paddingHorizontal: spacing.md,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: active ? colors.brand : colors.border,
        backgroundColor: active ? colors.brand : colors.surface,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          ...type.caption,
          color: active ? colors.onBrand : colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
