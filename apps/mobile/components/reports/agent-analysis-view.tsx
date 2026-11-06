import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { BulletList, Score } from "@/components/customer-analysis-view";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { IconSymbol, type IconName } from "@/components/ui/icon-symbol";
import { numeric, radius, rtlText, spacing, type } from "@/constants/theme";
import { relativeTimeLabel } from "@/lib/format";
import { reportInteger } from "@/lib/operations-report";
import { useTheme } from "@/providers/theme-provider";
import type {
  AgentDimensionKey,
  AgentIncidentCategory,
  AgentIncidentSeverity,
  AgentVerdict,
  CustomerServiceAgentAnalysis,
} from "@/types/api";

/**
 * The owner's review of one employee: computed numbers first, then the AI's
 * read of her behaviour with the chats behind each finding one tap away, then
 * what to do about it. Rendering only; the screen owns loading and re-runs.
 */

const verdicts: Record<AgentVerdict, { label: string; tone: BadgeTone }> = {
  excellent: { label: "ممتازة — قدوة للفريق", tone: "success" },
  good: { label: "جيدة مع ملاحظات", tone: "info" },
  needs_coaching: { label: "تحتاج تدريبًا", tone: "warning" },
  needs_intervention: { label: "تحتاج تدخلًا فوريًا", tone: "danger" },
};

const dimensionLabels: Record<AgentDimensionKey, string> = {
  responsiveness: "سرعة الاستجابة",
  clarity: "وضوح الرد",
  courtesy: "اللباقة والتعاطف",
  resolution: "حل طلب العميلة",
  follow_up: "المتابعة",
  accuracy: "دقة المعلومات والأسعار",
  sales: "تحويل الاستفسار لحجز",
};

const severities: Record<AgentIncidentSeverity, { label: string; tone: BadgeTone }> = {
  high: { label: "خطير", tone: "danger" },
  medium: { label: "متوسط", tone: "warning" },
  low: { label: "بسيط", tone: "neutral" },
};

const categoryLabels: Record<AgentIncidentCategory, string> = {
  slow_reply: "رد متأخر",
  no_reply: "بلا رد",
  wrong_info: "معلومة خاطئة",
  tone: "أسلوب غير مناسب",
  unresolved: "طلب لم يُحل",
  broken_promise: "وعد لم يُنفّذ",
  missed_booking: "فرصة حجز ضائعة",
  policy: "مخالفة سياسة",
  other: "ملاحظة",
};

const priorities: Record<"now" | "this_week" | "ongoing", { label: string; tone: BadgeTone }> = {
  now: { label: "اليوم", tone: "danger" },
  this_week: { label: "هذا الأسبوع", tone: "warning" },
  ongoing: { label: "متابعة مستمرة", tone: "info" },
};

const comparisonLabels = {
  first_response_minutes: { label: "متوسط أول رد", unit: "د", lowerIsBetter: true },
  booking_rate: { label: "تحويل المحادثات لحجز", unit: "٪", lowerIsBetter: false },
  resolved_share: { label: "محادثات أغلقتها", unit: "٪", lowerIsBetter: false },
  replies_per_chat: { label: "ردود لكل محادثة", unit: "", lowerIsBetter: null },
} as const;

function minutes(value: number | null) {
  if (value === null) return "—";
  if (value < 60) return `${reportInteger.format(Math.round(value))} د`;
  return `${(Math.round((value / 60) * 10) / 10).toLocaleString("ar-SA")} س`;
}

function SectionTitle({ title, icon, color }: { title: string; icon: IconName; color: string }) {
  return (
    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
      <IconSymbol name={icon} size={18} color={color} />
      <Text style={{ ...type.headline, ...rtlText, color }}>{title}</Text>
    </View>
  );
}

function ChatLink({
  conversationId,
  label,
  children,
}: {
  conversationId: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={{ pathname: "/conversation/[id]", params: { id: conversationId } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
      >
        {children}
      </Pressable>
    </Link>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: "45%",
        padding: spacing.md,
        gap: spacing.xs,
        borderRadius: radius.lg,
        backgroundColor: colors.surfaceSunken,
      }}
    >
      <Text style={{ ...type.caption, ...rtlText, color: colors.textSecondary }}>{label}</Text>
      <Text selectable style={{ ...type.title3, ...numeric, ...rtlText, color: tone ?? colors.text }}>
        {value}
      </Text>
    </View>
  );
}

function Quote({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        borderRightWidth: 3,
        borderRightColor: colors.border,
        paddingRight: spacing.md,
        paddingVertical: spacing.xs,
      }}
    >
      <Text selectable style={{ ...type.callout, ...rtlText, color: colors.text, fontStyle: "italic" }}>
        «{text}»
      </Text>
    </View>
  );
}

export function AgentAnalysisView({ analysis }: { analysis: CustomerServiceAgentAnalysis }) {
  const { colors } = useTheme();
  const verdict = analysis.verdict ? verdicts[analysis.verdict] : null;
  const facts = analysis.facts;
  const dimensions = analysis.dimensions ?? [];
  const incidents = analysis.incidents ?? [];
  const goodExamples = analysis.goodExamples ?? [];
  const ownerActions = analysis.ownerActions ?? [];
  const talkingPoints = analysis.talkingPoints ?? [];
  // A server from before the detailed review sends only the lists.
  const legacy = !analysis.dimensions;

  return (
    <View style={{ gap: spacing.lg }}>
      {analysis.aiUnavailable ? (
        <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warningSoft }}>
          <SectionTitle title="لم يكتمل تحليل الذكاء الاصطناعي" icon="exclamationmark.triangle" color={colors.onWarningSoft} />
          <Text style={{ ...type.footnote, ...rtlText, color: colors.onWarningSoft }}>
            الأرقام أدناه محسوبة من المحادثات وركاز وهي دقيقة. أما قراءة السلوك والمواقف فلم تكتمل في الوقت
            المتاح؛ جرّبي «إعادة التحليل» أو اختاري فترة أقصر.
          </Text>
        </Card>
      ) : (
        <View style={{ gap: spacing.md }}>
          <Score value={analysis.score} label="تقييم جودة التعامل" />
        {verdict ? (
          <View style={{ flexDirection: "row-reverse" }}>
            <Badge label={verdict.label} tone={verdict.tone} />
          </View>
        ) : null}
        <Text selectable style={{ ...type.body, ...rtlText, color: colors.textSecondary }}>
          {analysis.summary}
        </Text>
      </View>
      )}

      {facts ? (
        <>
          <Divider />
          <View style={{ gap: spacing.md }}>
            <SectionTitle title="أرقام محسوبة من المحادثات" icon="clock" color={colors.text} />
            <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
              <Fact label="وسيط زمن ردها" value={minutes(facts.medianReplyMinutes)} />
              <Fact label="٩٠٪ من ردودها خلال" value={minutes(facts.p90ReplyMinutes)} />
              <Fact
                label={`ردود تأخرت أكثر من ${reportInteger.format(facts.slowReplyMinutes)} د`}
                value={reportInteger.format(facts.slowReplies)}
                tone={facts.slowReplies ? colors.warning : undefined}
              />
              <Fact
                label="عميلات تُركن بلا رد"
                value={reportInteger.format(facts.leftWaiting.length)}
                tone={facts.leftWaiting.length ? colors.danger : undefined}
              />
            </View>
            {facts.comparison.some((item) => item.her !== null) ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.text }}>مقارنة بمتوسط الفريق</Text>
                {facts.comparison.map((item) => {
                  const meta = comparisonLabels[item.key];
                  const better =
                    item.her === null || item.team === null || meta.lowerIsBetter === null || item.her === item.team
                      ? null
                      : meta.lowerIsBetter
                        ? item.her < item.team
                        : item.her > item.team;
                  const fmt = (value: number | null) =>
                    value === null ? "—" : `${value.toLocaleString("ar-SA")}${meta.unit ? ` ${meta.unit}` : ""}`;
                  return (
                    <View
                      key={item.key}
                      style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}
                    >
                      <Text style={{ flex: 1, ...type.callout, ...rtlText, color: colors.textSecondary }}>
                        {meta.label}
                      </Text>
                      <Text
                        selectable
                        style={{
                          ...type.subheadStrong,
                          ...numeric,
                          color: better === null ? colors.text : better ? colors.success : colors.danger,
                        }}
                      >
                        {fmt(item.her)}
                      </Text>
                      <Text style={{ ...type.caption, ...numeric, color: colors.textTertiary }}>
                        الفريق {fmt(item.team)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      {analysis.bookings ? <BookingResults analysis={analysis} /> : null}

      {facts?.leftWaiting.length ? (
        <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft }}>
          <SectionTitle title="عميلات تُركن بلا رد" icon="exclamationmark.triangle" color={colors.onDangerSoft} />
          <Text style={{ ...type.footnote, ...rtlText, color: colors.onDangerSoft }}>
            كانت آخر من ردّ، ثم كتبت العميلة ولم يردّ أحد حتى نهاية الفترة.
          </Text>
          {facts.leftWaiting.map((item) => (
            <ChatLink
              key={item.conversationId}
              conversationId={item.conversationId}
              label={`فتح محادثة ${item.customerName ?? "العميلة"}`}
            >
              <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm, minHeight: 36 }}>
                <Text style={{ flex: 1, ...type.bodyStrong, ...rtlText, color: colors.onDangerSoft }}>
                  {item.customerName || "عميلة"}
                </Text>
                <Text style={{ ...type.caption, color: colors.onDangerSoft }}>
                  تنتظر منذ {relativeTimeLabel(item.waitingSince)}
                </Text>
                <IconSymbol name="chevron.left" size={16} color={colors.onDangerSoft} />
              </View>
            </ChatLink>
          ))}
        </Card>
      ) : null}

      {dimensions.length ? (
        <View style={{ gap: spacing.md }}>
          <SectionTitle title="تقييم السلوك بالتفصيل" icon="chart.bar" color={colors.text} />
          {dimensions.map((dimension) => {
            const value = Math.max(0, Math.min(100, dimension.score));
            const tone = value >= 75 ? colors.success : value >= 50 ? colors.warning : colors.danger;
            return (
              <View key={dimension.key} style={{ gap: spacing.xs }}>
                <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
                  <Text style={{ flex: 1, ...type.subheadStrong, ...rtlText, color: colors.text }}>
                    {dimensionLabels[dimension.key]}
                  </Text>
                  {dimension.confidence === "low" ? <Badge label="دليل قليل" tone="neutral" /> : null}
                  <Text style={{ ...type.subheadStrong, ...numeric, color: tone }}>
                    {reportInteger.format(value)}
                  </Text>
                </View>
                <View
                  style={{ height: 6, overflow: "hidden", borderRadius: radius.full, backgroundColor: colors.surfaceSunken }}
                >
                  <View style={{ width: `${value}%`, height: "100%", borderRadius: radius.full, backgroundColor: tone }} />
                </View>
                <Text selectable style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
                  {dimension.finding}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {incidents.length ? (
        <View style={{ gap: spacing.md }}>
          <SectionTitle title="مواقف تحتاج مراجعتك" icon="exclamationmark.circle" color={colors.danger} />
          <Text style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
            اضغطي على أي موقف لفتح المحادثة والتأكد قبل الحديث معها.
          </Text>
          {incidents.map((incident, index) => {
            const severity = severities[incident.severity];
            return (
              <ChatLink
                key={`${incident.conversationId}-${index}`}
                conversationId={incident.conversationId}
                label={`فتح محادثة ${incident.customerName ?? "العميلة"}: ${categoryLabels[incident.category]}`}
              >
                <Card>
                  <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
                    <Badge label={severity.label} tone={severity.tone} />
                    <Badge label={categoryLabels[incident.category]} tone="neutral" />
                    <Text style={{ flex: 1, ...type.subheadStrong, ...rtlText, color: colors.text }}>
                      {incident.customerName || "عميلة"}
                    </Text>
                    <IconSymbol name="chevron.left" size={16} color={colors.textTertiary} />
                  </View>
                  <Text selectable style={{ ...type.callout, ...rtlText, color: colors.text }}>
                    {incident.whatHappened}
                  </Text>
                  {incident.quote ? <Quote text={incident.quote} /> : null}
                  <Text selectable style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
                    الأثر: {incident.impact}
                  </Text>
                  <Text selectable style={{ ...type.footnote, ...rtlText, color: colors.onSuccessSoft }}>
                    الأفضل: {incident.betterResponse}
                  </Text>
                </Card>
              </ChatLink>
            );
          })}
        </View>
      ) : null}

      {goodExamples.length ? (
        <View style={{ gap: spacing.md }}>
          <SectionTitle title="مواقف أحسنت فيها" icon="checkmark.circle" color={colors.success} />
          {goodExamples.map((example, index) => (
            <ChatLink
              key={`${example.conversationId}-${index}`}
              conversationId={example.conversationId}
              label={`فتح محادثة ${example.customerName ?? "العميلة"}`}
            >
              <Card>
                <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
                  <Text style={{ flex: 1, ...type.subheadStrong, ...rtlText, color: colors.text }}>
                    {example.customerName || "عميلة"}
                  </Text>
                  <IconSymbol name="chevron.left" size={16} color={colors.textTertiary} />
                </View>
                <Text selectable style={{ ...type.callout, ...rtlText, color: colors.text }}>
                  {example.whatHappened}
                </Text>
                {example.quote ? <Quote text={example.quote} /> : null}
              </Card>
            </ChatLink>
          ))}
        </View>
      ) : null}

      {analysis.repeatedPatterns.length ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.text }}>أنماط متكررة</Text>
          <BulletList items={analysis.repeatedPatterns} color={colors.textSecondary} />
        </View>
      ) : null}
      {analysis.risks.length ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.danger }}>مخاطر إن استمر الوضع</Text>
          <BulletList items={analysis.risks} color={colors.danger} />
        </View>
      ) : null}
      {legacy && analysis.strengths.length ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.success }}>نقاط القوة</Text>
          <BulletList items={analysis.strengths} color={colors.text} />
        </View>
      ) : null}
      {legacy && analysis.improvements.length ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.warning }}>فرص التحسين</Text>
          <BulletList items={analysis.improvements} color={colors.text} />
        </View>
      ) : null}

      {ownerActions.length ? (
        <Card style={{ backgroundColor: colors.brandSoft, borderColor: colors.brandSoft }}>
          <SectionTitle title="خطة العمل معها" icon="checkmark" color={colors.onBrandSoft} />
          {ownerActions.map((item, index) => (
            <View key={index} style={{ gap: spacing.xs }}>
              <View style={{ flexDirection: "row-reverse", alignItems: "flex-start", gap: spacing.sm }}>
                <Badge label={priorities[item.priority].label} tone={priorities[item.priority].tone} />
                <Text selectable style={{ flex: 1, ...type.bodyStrong, ...rtlText, color: colors.onBrandSoft }}>
                  {item.action}
                </Text>
              </View>
              <Text selectable style={{ ...type.footnote, ...rtlText, color: colors.onBrandSoft }}>
                {item.reason}
              </Text>
            </View>
          ))}
        </Card>
      ) : legacy && analysis.recommendations.length ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.brand }}>خطوات مقترحة</Text>
          <BulletList items={analysis.recommendations} color={colors.text} />
        </View>
      ) : null}

      {talkingPoints.length ? (
        <Card>
          <SectionTitle title="نقاط للجلسة الفردية معها" icon="message" color={colors.text} />
          {talkingPoints.map((point, index) => (
            <View key={index} style={{ flexDirection: "row-reverse", gap: spacing.sm }}>
              <Text style={{ ...type.subheadStrong, ...numeric, color: colors.brand }}>
                {reportInteger.format(index + 1)}.
              </Text>
              <Text selectable style={{ flex: 1, ...type.callout, ...rtlText, color: colors.text }}>
                {point}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>
        {analysis.basis.conversationsReviewed !== undefined &&
        analysis.basis.conversationsReviewed < analysis.basis.conversations
          ? `قرأ التحليل ${reportInteger.format(analysis.basis.conversationsReviewed)} من ${reportInteger.format(analysis.basis.conversations)} محادثة (الأحق بالمراجعة أولًا)، والأرقام محسوبة من كل المحادثات. `
          : `بُني على ${reportInteger.format(analysis.basis.conversations)} محادثة و${reportInteger.format(analysis.basis.agentReplies)} رد للموظفة. `}
        {analysis.evidenceNote ? `${analysis.evidenceNote} ` : ""}
        التحليل آلي وقد يخطئ، فافتحي المحادثة قبل أي قرار.
      </Text>
    </View>
  );
}

const sheetLabels = {
  booked: "مسجلة: تم الحجز",
  not_booked: "مسجلة: لم يتم الحجز",
  no_reply: "مسجلة: لم ترد",
} as const;

function percent(value: number | null) {
  return value === null ? "—" : `${reportInteger.format(value)}٪`;
}

/** How many of her chats became bookings, and how many customers keep coming back to her. */
function BookingResults({ analysis }: { analysis: CustomerServiceAgentAnalysis }) {
  const { colors } = useTheme();
  const [showLost, setShowLost] = useState(false);
  const bookings = analysis.bookings!;
  const { conversion, retention } = bookings;
  const lostReasons = analysis.lostBookingReasons ?? [];
  const bookedShare = conversion.handled ? (conversion.booked / conversion.handled) * 100 : 0;

  return (
    <>
      <Divider />
      <View style={{ gap: spacing.md }}>
        <SectionTitle title="من المحادثة إلى الحجز" icon="calendar" color={colors.text} />
        <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
          <Fact label="محادثات تعاملت معها" value={reportInteger.format(conversion.handled)} />
          <Fact
            label="تحوّلت لحجز"
            value={`${reportInteger.format(conversion.booked)} · ${percent(conversion.rate)}`}
            tone={colors.success}
          />
          <Fact
            label="لم تتحول لحجز"
            value={reportInteger.format(conversion.notBooked)}
            tone={conversion.notBooked ? colors.warning : undefined}
          />
          <Fact
            label="حُجزت ثم أُلغيت"
            value={reportInteger.format(conversion.cancelled)}
            tone={conversion.cancelled ? colors.danger : undefined}
          />
        </View>
        <View
          style={{ height: 8, overflow: "hidden", borderRadius: radius.full, backgroundColor: colors.warningSoft, flexDirection: "row-reverse" }}
        >
          <View style={{ width: `${bookedShare}%`, height: "100%", backgroundColor: colors.success }} />
        </View>
        <Text selectable style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
          أدخلت الحجز هي {reportInteger.format(conversion.bookedByHer)} · موظفة أخرى{" "}
          {reportInteger.format(conversion.bookedByColleague)} · العميلة أونلاين{" "}
          {reportInteger.format(conversion.bookedOnline)}
        </Text>
        {conversion.notBooked ? (
          <Text selectable style={{ ...type.footnote, ...rtlText, color: colors.textSecondary }}>
            غير المحجوزة حسب نتيجة التواصل: «لم يتم الحجز» {reportInteger.format(conversion.notBookedMarked.notBooked)} ·
            «لم ترد» {reportInteger.format(conversion.notBookedMarked.noReply)} · بلا نتيجة مسجلة{" "}
            {reportInteger.format(conversion.notBookedMarked.unmarked)}
          </Text>
        ) : null}
        {analysis.conversionInsight ? (
          <Text selectable style={{ ...type.callout, ...rtlText, color: colors.text }}>
            {analysis.conversionInsight}
          </Text>
        ) : null}
        {lostReasons.length ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.warning }}>لماذا لم تُحجز</Text>
            <BulletList items={lostReasons} color={colors.text} />
          </View>
        ) : null}
        {conversion.notBookedChats.length ? (
          <View style={{ gap: spacing.sm }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showLost ? "إخفاء المحادثات التي لم تتحول لحجز" : "عرض المحادثات التي لم تتحول لحجز"}
              onPress={() => setShowLost((value) => !value)}
              style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1, flexDirection: "row-reverse", alignItems: "center", gap: spacing.xs, minHeight: 36 })}
            >
              <Text style={{ ...type.subheadStrong, ...rtlText, color: colors.brand }}>
                {showLost ? "إخفاء المحادثات غير المحجوزة" : "عرض المحادثات غير المحجوزة"}
              </Text>
              <IconSymbol name={showLost ? "chevron.up" : "chevron.down"} size={14} color={colors.brand} />
            </Pressable>
            {showLost
              ? conversion.notBookedChats.map((chat) => (
                  <ChatLink
                    key={chat.conversationId}
                    conversationId={chat.conversationId}
                    label={`فتح محادثة ${chat.customerName ?? "العميلة"}`}
                  >
                    <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm, minHeight: 36 }}>
                      <Text style={{ flex: 1, ...type.callout, ...rtlText, color: colors.text }}>
                        {chat.customerName || "عميلة"}
                      </Text>
                      <Text style={{ ...type.caption, color: colors.textTertiary }}>
                        {chat.sheetOutcome ? sheetLabels[chat.sheetOutcome] : "بلا نتيجة مسجلة"}
                      </Text>
                      <IconSymbol name="chevron.left" size={16} color={colors.textTertiary} />
                    </View>
                  </ChatLink>
                ))
              : null}
          </View>
        ) : null}
        <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>
          تُحسب المحادثة محجوزة إذا وُجد في ركاز حجز للعميلة نفسها بعد ردها وحتى{" "}
          {reportInteger.format(conversion.graceDays)} أيام بعد نهاية الفترة.
        </Text>
      </View>

      <Divider />
      <View style={{ gap: spacing.md }}>
        <SectionTitle title="عميلات دائمات" icon="person.2" color={colors.text} />
        <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
          <Fact label="تعاملت معهن أكثر من مرة" value={reportInteger.format(retention.repeatHandled)} />
          <Fact
            label="حجزن مرتين أو أكثر"
            value={`${reportInteger.format(retention.repeatBookers)} · ${percent(retention.rate)}`}
            tone={colors.success}
          />
        </View>
        {retention.customers.map((customer) => (
          <ChatLink
            key={customer.conversationId}
            conversationId={customer.conversationId}
            label={`فتح محادثة ${customer.customerName ?? "العميلة"}`}
          >
            <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm, minHeight: 36 }}>
              <Text style={{ flex: 1, ...type.callout, ...rtlText, color: colors.text }}>
                {customer.customerName || "عميلة"}
              </Text>
              <Text style={{ ...type.caption, ...numeric, color: colors.textSecondary }}>
                {reportInteger.format(customer.bookings)} حجوزات · {reportInteger.format(customer.handledDays)} أيام تواصل
              </Text>
              <IconSymbol name="chevron.left" size={16} color={colors.textTertiary} />
            </View>
          </ChatLink>
        ))}
        <Text style={{ ...type.caption, ...rtlText, color: colors.textTertiary }}>
          تُحسب فقط العميلات اللواتي تعاملت معهن هي في يومين مختلفين أو أكثر، وتُعد حجوزاتهن غير الملغاة منذ أول رد لها.
        </Text>
      </View>
    </>
  );
}
