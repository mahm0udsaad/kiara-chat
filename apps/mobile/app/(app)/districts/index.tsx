import { useState } from "react";
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { EmptyState, ErrorState, InlineAlert, LoadingScreen } from "@/components/screen-state";
import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { errorFeedback, successFeedback, tapFeedback } from "@/lib/haptics";
import {
  useBootstrap,
  useCreateDistrict,
  useDeleteDistrict,
  useDistricts,
  useUpdateDistrict,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { District } from "@/types/api";

const priceFormatter = new Intl.NumberFormat("ar-SA", {
  style: "currency",
  currency: "SAR",
  maximumFractionDigits: 2,
});

/**
 * Admin-only: the districts an order can name, and what a trip to each costs.
 *
 * Choosing a district on an order copies its fare onto that order, so editing
 * a price here applies to the next orders, never to trips already priced. A
 * district that past orders use is archived instead of deleted, so their
 * trips keep the name and the fare they were given.
 */
export default function DistrictsScreen() {
  const { colors } = useTheme();
  const bootstrap = useBootstrap();
  const allowed = bootstrap.data?.capabilities.canManageDistricts === true;
  const districts = useDistricts(allowed);
  const create = useCreateDistrict();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (bootstrap.isLoading || (allowed && districts.isLoading)) return <LoadingScreen />;
  if (!allowed) {
    return (
      <EmptyState
        icon="lock"
        title="للإدارة فقط"
        detail="إضافة الأحياء وتسعير المشاوير متاح للإدارة فقط."
      />
    );
  }
  if (districts.isError || !districts.data) {
    return (
      <ErrorState
        message={districts.error?.message ?? "تعذر تحميل الأحياء"}
        onRetry={() => void districts.refetch()}
      />
    );
  }

  const add = () => {
    setNotice(null);
    if (name.trim().length < 2) return setFormError("اكتبي اسم الحي.");
    if (!price.trim()) return setFormError("اكتبي تكلفة المشوار.");
    setFormError(null);
    create.mutate(
      { name: name.trim(), tripPrice: price.trim() },
      {
        onSuccess: () => {
          successFeedback();
          setName("");
          setPrice("");
        },
        onError: (error) => {
          errorFeedback();
          setFormError(error.message);
        },
      },
    );
  };

  const list = districts.data.districts;
  const active = list.filter((item) => item.is_active);
  const archived = list.filter((item) => !item.is_active);

  return (
    <KeyboardAvoidingView
      behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing["4xl"] }}
      >
        <InlineAlert
          tone="info"
          message="عند اختيار الحي في الطلب تُحسب تكلفة المشوار تلقائيًا. تعديل السعر هنا يطبق على الطلبات الجديدة فقط."
        />

        <Card>
          <Text style={{ ...type.headline, color: colors.text, ...rtlText }}>إضافة حي</Text>
          <Field
            label="اسم الحي"
            icon="mappin.and.ellipse"
            value={name}
            onChangeText={(value) => {
              setName(value);
              setFormError(null);
            }}
            maxLength={80}
            placeholder="مثال: حي الفهد"
          />
          <Field
            label="تكلفة المشوار (ر.س)"
            icon="banknote"
            value={price}
            onChangeText={(value) => {
              setPrice(value);
              setFormError(null);
            }}
            keyboardType="decimal-pad"
            placeholder="مثال: 25"
          />
          {formError ? <InlineAlert message={formError} /> : null}
          <PrimaryButton
            label="إضافة الحي"
            icon="plus"
            loading={create.isPending}
            onPress={add}
            testID="district-add"
          />
        </Card>

        {notice ? <InlineAlert tone="info" message={notice} /> : null}

        {list.length === 0 ? (
          <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
            لا توجد أحياء بعد.
          </Text>
        ) : null}

        {active.length ? (
          <DistrictList title="الأحياء" items={active} onNotice={setNotice} />
        ) : null}
        {archived.length ? (
          <DistrictList title="موقوفة — لا تظهر في الطلبات" items={archived} onNotice={setNotice} />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DistrictList({
  title,
  items,
  onNotice,
}: {
  title: string;
  items: District[];
  onNotice: (message: string | null) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ ...type.subheadStrong, color: colors.textSecondary, ...rtlText }}>
        {title}
      </Text>
      <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
        {items.map((district, index) => (
          <View key={district.id}>
            {index ? <Divider /> : null}
            <DistrictRow district={district} onNotice={onNotice} />
          </View>
        ))}
      </Card>
    </View>
  );
}

function DistrictRow({
  district,
  onNotice,
}: {
  district: District;
  onNotice: (message: string | null) => void;
}) {
  const { colors } = useTheme();
  const update = useUpdateDistrict();
  const remove = useDeleteDistrict();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(district.name);
  const [price, setPrice] = useState(String(district.trip_price ?? ""));
  const [error, setError] = useState<string | null>(null);
  const busy = update.isPending || remove.isPending;

  const save = () => {
    setError(null);
    onNotice(null);
    update.mutate(
      { id: district.id, name: name.trim(), tripPrice: price.trim() },
      {
        onSuccess: () => {
          successFeedback();
          setEditing(false);
        },
        onError: (failure) => {
          errorFeedback();
          setError(failure.message);
        },
      },
    );
  };

  const toggleActive = () => {
    setError(null);
    onNotice(null);
    update.mutate(
      { id: district.id, isActive: !district.is_active },
      { onError: (failure) => setError(failure.message) },
    );
  };

  const confirmDelete = () => {
    Alert.alert("حذف الحي؟", `سيُحذف «${district.name}» من قائمة الأحياء.`, [
      { text: "رجوع", style: "cancel" },
      {
        text: "حذف",
        style: "destructive",
        onPress: () => {
          setError(null);
          onNotice(null);
          remove.mutate(district.id, {
            onSuccess: ({ archived }) => {
              successFeedback();
              if (archived) {
                onNotice(
                  `«${district.name}» مستخدم في طلبات سابقة، فأُوقف بدل حذفه حتى تبقى تكلفتها كما هي.`,
                );
              }
            },
            onError: (failure) => {
              errorFeedback();
              setError(failure.message);
            },
          });
        },
      },
    ]);
  };

  if (editing) {
    return (
      <View style={{ gap: spacing.md, paddingVertical: spacing.md }}>
        <Field
          label="اسم الحي"
          value={name}
          onChangeText={setName}
          maxLength={80}
        />
        <Field
          label="تكلفة المشوار (ر.س)"
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          hint="السعر الجديد يطبق على الطلبات التي تختار هذا الحي من الآن."
        />
        {error ? <InlineAlert message={error} /> : null}
        <PrimaryButton label="حفظ" icon="checkmark" loading={update.isPending} onPress={save} />
        <PrimaryButton
          label="إلغاء"
          variant="plain"
          disabled={update.isPending}
          onPress={() => {
            setEditing(false);
            setName(district.name);
            setPrice(String(district.trip_price ?? ""));
            setError(null);
          }}
        />
      </View>
    );
  }

  const action = (
    label: string,
    icon: "pencil" | "eye.slash" | "eye" | "trash",
    onPress: () => void,
    tint = colors.textSecondary,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${district.name}`}
      disabled={busy}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        width: hitSize.min,
        height: hitSize.min,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.full,
        opacity: busy ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <IconSymbol name={icon} size={18} color={tint} />
    </Pressable>
  );

  return (
    <View style={{ paddingVertical: spacing.sm, gap: spacing.xs }}>
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.calloutStrong, color: colors.text, ...rtlText }}>
            {district.name}
          </Text>
          <Text style={{ ...type.footnote, ...numeric, color: colors.brand, ...rtlText }}>
            {district.trip_price != null ? priceFormatter.format(district.trip_price) : "—"}
          </Text>
        </View>
        {!district.is_active ? <Badge label="موقوف" tone="neutral" /> : null}
        {action("تعديل", "pencil", () => setEditing(true))}
        {action(
          district.is_active ? "إيقاف" : "تفعيل",
          district.is_active ? "eye.slash" : "eye",
          toggleActive,
        )}
        {action("حذف", "trash", confirmDelete, colors.danger)}
      </View>
      {error ? <InlineAlert message={error} /> : null}
    </View>
  );
}
