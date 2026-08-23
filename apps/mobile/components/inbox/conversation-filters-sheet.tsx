import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionBar, PrimaryButton } from "@/components/primary-button";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { csStatusLabel } from "@/lib/format";
import { tapFeedback } from "@/lib/haptics";
import { useTheme } from "@/providers/theme-provider";
import type {
  ConversationFilters,
  ConversationLabel,
  ConversationSection,
  CsStatus,
} from "@/types/api";

const STATUS_ORDER: CsStatus[] = ["open", "waiting", "resolved"];
const SECTION_LABEL: Record<ConversationSection, string> = {
  orders: "قسم الطلبات",
  replies: "قسم الردود",
};
const SECTION_ORDER: ConversationSection[] = ["orders", "replies"];

/** How many refinements are on — drives the badge on the inbox's filter button. */
export function activeFilterCount(filters: ConversationFilters): number {
  return (
    (filters.status ? 1 : 0) +
    (filters.section ? 1 : 0) +
    (filters.labelId ? 1 : 0)
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: "row-reverse",
        alignItems: "center",
        gap: spacing.xs,
        minHeight: hitSize.min,
        paddingHorizontal: spacing.md + 2,
        borderRadius: radius.full,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colors.brand : colors.border,
        backgroundColor: selected
          ? colors.brandSoft
          : pressed
            ? colors.surfaceSunken
            : colors.surface,
      })}
    >
      {selected ? <IconSymbol name="checkmark" color={colors.brand} size={14} /> : null}
      <Text
        style={{
          ...type.subhead,
          fontWeight: selected ? "700" : "400",
          color: selected ? colors.onBrandSoft : colors.textSecondary,
          ...rtlText,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>{title}</Text>
      <View
        style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * The refinements the web inbox keeps in dropdowns beside its view tabs —
 * status, section, label — in the one place a phone has room for them.
 *
 * They narrow whichever view is open rather than replacing it, so the tab
 * counts keep answering "how many are in this view" while the list answers
 * "how many of those match".
 */
export function ConversationFiltersSheet({
  open,
  filters,
  labels,
  onClose,
  onChange,
}: {
  open: boolean;
  filters: ConversationFilters;
  labels: ConversationLabel[];
  onClose: () => void;
  onChange: (filters: ConversationFilters) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

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
          <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>تصفية</Text>
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

        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl }}
        >
          <Group title="حالة المحادثة">
            <Choice
              label="كل الحالات"
              selected={!filters.status}
              onPress={() => onChange({ ...filters, status: null })}
            />
            {STATUS_ORDER.map((status) => (
              <Choice
                key={status}
                label={csStatusLabel[status]}
                selected={filters.status === status}
                onPress={() => onChange({ ...filters, status })}
              />
            ))}
          </Group>

          <Group title="القسم">
            <Choice
              label="كل الأقسام"
              selected={!filters.section}
              onPress={() => onChange({ ...filters, section: null })}
            />
            {SECTION_ORDER.map((section) => (
              <Choice
                key={section}
                label={SECTION_LABEL[section]}
                selected={filters.section === section}
                onPress={() => onChange({ ...filters, section })}
              />
            ))}
          </Group>

          {labels.length ? (
            <Group title="التصنيف">
              <Choice
                label="كل التصنيفات"
                selected={!filters.labelId}
                onPress={() => onChange({ ...filters, labelId: null })}
              />
              {labels.map((label) => (
                <Choice
                  key={label.id}
                  label={label.name}
                  selected={filters.labelId === label.id}
                  onPress={() => onChange({ ...filters, labelId: label.id })}
                />
              ))}
            </Group>
          ) : null}
        </ScrollView>

        <ActionBar bottomInset={insets.bottom}>
          <PrimaryButton label="عرض النتائج" icon="checkmark" onPress={onClose} />
          <PrimaryButton
            label="مسح التصفية"
            variant="plain"
            silent
            disabled={activeFilterCount(filters) === 0}
            onPress={() =>
              onChange({ status: null, section: null, labelId: null })
            }
          />
        </ActionBar>
      </View>
    </Modal>
  );
}
