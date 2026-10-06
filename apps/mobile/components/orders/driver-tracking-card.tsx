import { useRouter } from "expo-router";
import { Linking, Pressable, Text, View } from "react-native";

import { PrimaryButton } from "@/components/primary-button";
import { TripPathCanvas } from "@/components/orders/trip-path-canvas";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/detail-row";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { radius, rtlText, spacing, type } from "@/constants/theme";
import { formatters, relativeTimeLabel } from "@/lib/format";
import { useOrderTracking } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { OrderTracking, TrackingFlag, TrackingMilestone } from "@/types/api";

/**
 * "تتبع موقع السائق" on the order screen.
 *
 * Everything here is evidence for customer service, never a gate: it reads its
 * own endpoint, beside the order rather than inside it, so a failure shows a
 * line in this card and nothing else on the screen changes.
 */

const MILESTONE_LABEL: Record<TrackingMilestone["key"], string> = {
  confirmed: "تأكيد الرحلة",
  departed: "تحرك السائق (GPS)",
  specialist_arrived: "الوصول للأخصائية",
  pickup: "ركوب الأخصائية",
  client_arrived: "الوصول للعميلة",
  service_started: "بدء الخدمة",
};

const time = (iso: string) => formatters.time.format(new Date(iso));

function distanceLabel(metres: number) {
  return metres < 1_000 ? `${Math.round(metres)} م` : `${(metres / 1_000).toFixed(1)} كم`;
}

function minutesLabel(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} د`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} س ${rest} د` : `${hours} س`;
}

function flagCopy(flag: TrackingFlag): { text: string; tone: "danger" | "warning" | "info" } {
  switch (flag.code) {
    case "tap_far_from_specialist":
      return { tone: "danger", text: `ضغط السائق «وصلت للأخصائية» وهو على بعد ${distanceLabel(flag.metres)} من موقعها حسب GPS.` };
    case "tap_far_from_client":
      return { tone: "danger", text: `ضغط السائق «وصلت للعميلة» وهو على بعد ${distanceLabel(flag.metres)} من موقعها حسب GPS.` };
    case "expected_late":
      return {
        tone: "danger",
        text: `متوقع أن يصل ${flag.target === "client" ? "للعميلة" : "للأخصائية"} متأخرًا ${flag.minutes} د عن الموعد.`,
      };
    case "stale":
      return { tone: "warning", text: `لم يصل موقع جديد من جوال السائق منذ ${flag.minutes} د (قد يكون أغلق التطبيق أو فقد الإشارة).` };
    case "gps_gap":
      return { tone: "info", text: `انقطع إرسال الموقع أثناء الرحلة لمدة ${flag.minutes} د.` };
    case "no_fixes":
      return { tone: "warning", text: "بدأت الرحلة ولم يصل أي موقع من جوال السائق." };
  }
}

type PermissionView = { tone: BadgeTone; label: string; detail: string; needsAction: boolean };

function permissionView(tracking: OrderTracking): PermissionView {
  const status = tracking.driver?.status;
  if (!status) {
    return {
      tone: "neutral",
      label: "لم يصل رد من جوال السائق",
      detail: "قد يحتاج السائق لفتح التطبيق أو تحديثه حتى تظهر حالة الموقع.",
      needsAction: true,
    };
  }
  const since = `آخر تحديث من الجوال ${relativeTimeLabel(status.reportedAt)}`;
  if (status.permission === "granted" && status.servicesEnabled === false) {
    return { tone: "warning", label: "خدمة الموقع مغلقة في جوال السائق", detail: since, needsAction: true };
  }
  switch (status.permission) {
    case "granted":
      return {
        tone: "success",
        label: "السائق سمح بالوصول للموقع",
        detail: status.backgroundCapable === false
          ? `${since} · يُرسل الموقع فقط والتطبيق مفتوح`
          : since,
        needsAction: false,
      };
    case "blocked":
      return { tone: "danger", label: "السائق رفض الوصول للموقع", detail: `يجب تفعيله من إعدادات الجوال · ${since}`, needsAction: true };
    case "denied":
      return { tone: "warning", label: "السائق لم يسمح بالوصول للموقع", detail: since, needsAction: true };
    case "undetermined":
      return { tone: "warning", label: "لم يُسأل السائق عن الموقع بعد", detail: since, needsAction: true };
    case "unavailable":
      return { tone: "neutral", label: "الموقع غير متاح على جوال السائق", detail: since, needsAction: false };
  }
}

function tripBadge(tracking: OrderTracking): { tone: BadgeTone; label: string; icon: IconName } {
  if (!tracking.enabled) return { tone: "neutral", label: "غير مفعّل", icon: "eye.slash" };
  switch (tracking.trip.state) {
    case "active":
      return tracking.latest && tracking.latest.freshnessSeconds <= 180
        ? { tone: "success", label: "مباشر", icon: "mappin.and.ellipse" }
        : { tone: "warning", label: "الرحلة جارية", icon: "clock" };
    case "finished":
      return { tone: "info", label: "انتهت الرحلة", icon: "checkmark.circle" };
    case "cancelled":
      return { tone: "neutral", label: "ملغي", icon: "xmark.circle" };
    default:
      return { tone: "neutral", label: "لم تبدأ", icon: "hourglass" };
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 120, gap: 2 }}>
      <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>{label}</Text>
      <Text style={{ ...type.subheadStrong, color: colors.text, fontVariant: ["tabular-nums"], ...rtlText }}>
        {value}
      </Text>
    </View>
  );
}

function EtaPanel({ eta }: { eta: NonNullable<OrderTracking["eta"]> }) {
  const { colors } = useTheme();
  const late = eta.lateByMinutes != null && eta.lateByMinutes > 0;
  const where = eta.target === "client" ? "للعميلة" : "للأخصائية";
  return (
    <View
      style={{
        gap: spacing.xs,
        padding: spacing.md,
        borderRadius: radius.md,
        borderCurve: "continuous",
        backgroundColor: late ? colors.dangerSoft : colors.brandSoft,
      }}
    >
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
        <Text style={{ flex: 1, ...type.footnote, color: late ? colors.onDangerSoft : colors.onBrandSoft, ...rtlText }}>
          {`الوصول المتوقع ${where}`}
        </Text>
        {eta.lateByMinutes != null ? (
          <Badge
            label={late ? `متأخر ${eta.lateByMinutes} د` : eta.lateByMinutes < 0 ? `قبل الموعد بـ ${-eta.lateByMinutes} د` : "في الموعد"}
            tone={late ? "danger" : "success"}
            icon={late ? "exclamationmark.triangle" : "checkmark.circle"}
          />
        ) : null}
      </View>
      <Text
        style={{
          ...type.title2,
          color: late ? colors.onDangerSoft : colors.onBrandSoft,
          fontVariant: ["tabular-nums"],
          ...rtlText,
        }}
      >
        {eta.remainingSeconds <= 60 ? "وصل تقريبًا" : time(eta.at)}
      </Text>
      <Text style={{ ...type.caption, color: late ? colors.onDangerSoft : colors.onBrandSoft, ...rtlText }}>
        {[
          eta.remainingSeconds > 60 ? `بعد ${minutesLabel(eta.remainingSeconds)}` : null,
          eta.distanceMetres > 0 ? `${distanceLabel(eta.distanceMetres)} متبقية` : null,
          eta.scheduledAt ? `الموعد ${time(eta.scheduledAt)}` : null,
          eta.source === "live_speed" ? "حسب سرعة السائق الحالية" : "تقدير تقريبي",
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </View>
  );
}

function MilestoneRow({ milestone, last }: { milestone: TrackingMilestone; last: boolean }) {
  const { colors } = useTheme();
  const done = Boolean(milestone.at);
  const delta =
    milestone.at && milestone.plannedAt
      ? Math.round((Date.parse(milestone.at) - Date.parse(milestone.plannedAt)) / 60_000)
      : null;
  const farTap = milestone.tapDistanceMetres != null && milestone.tapDistanceMetres > 400;
  return (
    <View style={{ flexDirection: "row-reverse", gap: spacing.md }}>
      <View style={{ alignItems: "center", width: 18 }}>
        <View
          style={{
            width: 14,
            height: 14,
            marginTop: 3,
            borderRadius: 7,
            backgroundColor: done ? (milestone.source === "gps" ? colors.success : colors.brand) : colors.surface,
            borderWidth: 2,
            borderColor: done ? (milestone.source === "gps" ? colors.success : colors.brand) : colors.borderStrong,
          }}
        />
        {!last ? <View style={{ flex: 1, width: 2, marginVertical: 2, backgroundColor: colors.border }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2, paddingBottom: last ? 0 : spacing.md }}>
        <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
          <Text style={{ flex: 1, ...type.subheadStrong, color: done ? colors.text : colors.textTertiary, ...rtlText }}>
            {MILESTONE_LABEL[milestone.key]}
          </Text>
          <Text style={{ ...type.subhead, color: done ? colors.text : colors.textTertiary, fontVariant: ["tabular-nums"] }}>
            {milestone.at ? time(milestone.at) : "—"}
          </Text>
        </View>
        <Text style={{ ...type.caption, color: farTap ? colors.danger : colors.textSecondary, ...rtlText }}>
          {[
            milestone.source === "gps" ? "مثبت بـ GPS" : milestone.source === "tap" ? "بضغطة زر" : null,
            milestone.plannedAt ? `المخطط ${time(milestone.plannedAt)}` : null,
            delta != null && Math.abs(delta) >= 1 ? (delta > 0 ? `متأخر ${delta} د` : `مبكر ${-delta} د`) : null,
            milestone.tapDistanceMetres != null ? `على بعد ${distanceLabel(milestone.tapDistanceMetres)} حسب GPS` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "لم تتم بعد"}
        </Text>
      </View>
    </View>
  );
}

export function DriverTrackingCard({ orderId }: { orderId: string }) {
  const { colors } = useTheme();
  const router = useRouter();
  const query = useOrderTracking(orderId);

  if (query.isLoading) {
    return (
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="تتبع موقع السائق" />
        <Card>
          <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>جارٍ تحميل التتبع…</Text>
        </Card>
      </View>
    );
  }
  if (query.isError || !query.data) {
    return (
      <View style={{ gap: spacing.sm }}>
        <SectionHeader title="تتبع موقع السائق" />
        <Card>
          <Pressable accessibilityRole="button" onPress={() => void query.refetch()}>
            <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
              تعذر تحميل التتبع الآن. اضغطي لإعادة المحاولة.
            </Text>
          </Pressable>
        </Card>
      </View>
    );
  }

  const tracking = query.data.tracking;
  const badge = tripBadge(tracking);
  const permission = permissionView(tracking);
  const live = tracking.trip.state === "active";
  const latest = tracking.latest;
  const canRequest = Boolean(tracking.driver?.canReceivePush);

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionHeader title="تتبع موقع السائق" action={<Badge label={badge.label} tone={badge.tone} icon={badge.icon} />} />
      <Card style={{ gap: spacing.md }}>
        {/* Driver phone permission */}
        <View style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: spacing.sm }}>
          <IconSymbol
            name={permission.needsAction ? "exclamationmark.triangle" : "checkmark.circle"}
            color={permission.tone === "success" ? colors.success : permission.tone === "danger" ? colors.danger : permission.tone === "warning" ? colors.warning : colors.textTertiary}
            size={18}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
              {tracking.driver?.name ? `${permission.label} — ${tracking.driver.name}` : permission.label}
            </Text>
            <Text style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>{permission.detail}</Text>
            {tracking.driver?.lastRequestAt ? (
              <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
                {`آخر طلب تفعيل أُرسل ${relativeTimeLabel(tracking.driver.lastRequestAt)}`}
              </Text>
            ) : null}
          </View>
        </View>
        {tracking.driver && permission.needsAction ? (
          <View style={{ gap: spacing.xs }}>
            <PrimaryButton
              label="اطلبي من السائق تفعيل الموقع"
              icon="bell"
              variant="tinted"
              disabled={!canRequest}
              onPress={() => router.push({ pathname: "/orders/[id]/location-request", params: { id: orderId } })}
            />
            {!canRequest ? (
              <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
                لا يوجد جهاز مسجّل للسائق لاستقبال الإشعارات. اتصلي به ليفتح التطبيق.
              </Text>
            ) : null}
          </View>
        ) : null}

        {!tracking.enabled ? (
          <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
            {tracking.disabledReason === "order_before_tracking"
              ? "هذا الطلب أُنشئ قبل تفعيل التتبع، لذلك لا يُسجّل موقع السائق فيه."
              : "تتبع موقع السائق موقوف حاليًا من الإدارة."}
          </Text>
        ) : null}

        {tracking.eta ? <EtaPanel eta={tracking.eta} /> : null}

        {tracking.enabled ? (
          <>
            <TripPathCanvas
              points={tracking.points}
              places={tracking.places}
              latest={latest}
              live={live}
              emptyLabel={
                tracking.trip.state === "not_started"
                  ? "يبدأ المسار عند تأكيد السائق للرحلة"
                  : permission.needsAction
                    ? "لا يوجد مسار — موقع السائق غير مفعّل"
                    : "لم تصل مواقع من جوال السائق بعد"
              }
            />
            <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.md }}>
              <Legend color={colors.textSecondary} icon="car" label="الانطلاق" />
              <Legend color={colors.onBrandSoft} icon="sparkles" label="الأخصائية" />
              <Legend color={colors.onSuccessSoft} icon="mappin.and.ellipse" label="العميلة" />
            </View>
          </>
        ) : null}

        {tracking.stats.fixes > 0 ? (
          <>
            <Divider />
            <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.md }}>
              <Stat label="المسافة المقطوعة" value={distanceLabel(tracking.stats.distanceMetres)} />
              <Stat
                label="متوسط السرعة"
                value={tracking.stats.averageSpeedKph != null ? `${tracking.stats.averageSpeedKph} كم/س` : "—"}
              />
              <Stat
                label="تغطية GPS للرحلة"
                value={tracking.stats.coverage != null ? `${Math.round(tracking.stats.coverage * 100)}٪` : "—"}
              />
              <Stat label="آخر موقع" value={latest ? relativeTimeLabel(latest.at) : "—"} />
            </View>
            {latest ? (
              <PrimaryButton
                label="فتح آخر موقع في الخرائط"
                icon="mappin.and.ellipse"
                variant="outline"
                silent
                onPress={() =>
                  void Linking.openURL(
                    `https://www.google.com/maps/search/?api=1&query=${latest.lat},${latest.lng}`,
                  )
                }
              />
            ) : null}
          </>
        ) : null}

        {tracking.flags.length ? (
          <View style={{ gap: spacing.sm }}>
            {tracking.flags.map((flag, index) => {
              const copy = flagCopy(flag);
              const palette = {
                danger: { bg: colors.dangerSoft, fg: colors.onDangerSoft },
                warning: { bg: colors.warningSoft, fg: colors.onWarningSoft },
                info: { bg: colors.infoSoft, fg: colors.onInfoSoft },
              }[copy.tone];
              return (
                <View
                  key={`${flag.code}-${index}`}
                  style={{
                    flexDirection: "row-reverse",
                    alignItems: "flex-start",
                    gap: spacing.sm,
                    padding: spacing.md,
                    borderRadius: radius.md,
                    backgroundColor: palette.bg,
                  }}
                >
                  <IconSymbol name="exclamationmark.triangle" color={palette.fg} size={15} />
                  <Text selectable style={{ flex: 1, ...type.footnote, color: palette.fg, ...rtlText }}>
                    {copy.text}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {tracking.enabled && tracking.trip.state !== "not_started" ? (
          <>
            <Divider />
            <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>سجل الرحلة</Text>
            <View>
              {tracking.milestones.map((milestone, index) => (
                <MilestoneRow
                  key={milestone.key}
                  milestone={milestone}
                  last={index === tracking.milestones.length - 1}
                />
              ))}
            </View>
          </>
        ) : null}
      </Card>
    </View>
  );
}

function Legend({ color, icon, label }: { color: string; icon: IconName; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.xs }}>
      <IconSymbol name={icon} color={color} size={13} />
      <Text style={{ ...type.caption, color: colors.textSecondary }}>{label}</Text>
    </View>
  );
}
