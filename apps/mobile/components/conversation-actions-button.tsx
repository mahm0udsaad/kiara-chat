import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/primary-button";
import { InlineAlert } from "@/components/screen-state";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  bookingStageLabel,
  csStatusLabel,
  formatters,
} from "@/lib/format";
import { tapFeedback } from "@/lib/haptics";
import {
  useAddConversationNote,
  useConversationNotes,
  useReleaseConversation,
  useSetConversationRouting,
  useSetConversationSection,
  useTransferConversation,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type {
  BookingStage,
  ConversationActionsInput,
  ConversationLabel,
  ConversationSection,
  CsStatus,
  LabelColor,
  ReminderConfirmation,
  ReminderConfirmationStatus,
} from "@/types/api";

type Agent = { id: string; fullName: string | null; email: string | null };

type QuickReminderStatus = "awaiting_reply" | "confirmed";

const EMPTY_LABEL_IDS: string[] = [];
const CS_STATUS_OPTIONS: readonly CsStatus[] = ["open", "waiting", "resolved"];
const SECTION_OPTIONS: { value: ConversationSection | null; label: string }[] = [
  { value: "orders", label: "قسم الطلبات" },
  { value: "replies", label: "قسم الردود" },
  { value: null, label: "بدون قسم" },
];

const agentName = (agent: Agent | undefined, fallback = "موظفة") =>
  agent?.fullName?.trim() || agent?.email?.trim() || fallback;
const REMINDER_STATUS_LABEL: Record<ReminderConfirmationStatus, string> = {
  not_recorded: "غير مسجّل",
  awaiting_reply: "لم تؤكد بعد",
  confirmed: "أكدت الحضور",
  cancelled: "ألغت الحجز",
};

function quickReminderStatus(
  reminder: ReminderConfirmation | null,
): QuickReminderStatus | null {
  return reminder?.status === "confirmed" || reminder?.status === "awaiting_reply"
    ? reminder.status
    : null;
}

function sameIds(left: string[], right: string[]) {
  return (
    left.length === right.length && left.every((id) => right.includes(id))
  );
}

export function ConversationActionsButton({
  conversationId,
  csStatus,
  bookingStage,
  reminder,
  labelIds: labelIdsProp,
  labels,
  bookingStages,
  agents,
  assignedTo,
  myTeamMemberId,
  isAdmin,
  section,
  routedTo,
  canEdit,
  pending,
  error,
  onSave,
}: {
  conversationId: string;
  csStatus: CsStatus;
  bookingStage: BookingStage | null;
  reminder: ReminderConfirmation | null;
  // Older API builds omit this, so treat it as optional and default below.
  labelIds?: string[] | null;
  labels: ConversationLabel[];
  bookingStages: { id: BookingStage; label: string }[];
  agents: Agent[];
  assignedTo: string | null;
  myTeamMemberId: string | null;
  isAdmin: boolean;
  /** Detail-only fields; older API builds omit them. */
  section?: ConversationSection | null;
  routedTo?: string | null;
  canEdit: boolean;
  pending: boolean;
  error: string | null;
  onSave: (input: ConversationActionsInput, onSuccess: () => void) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const labelIds = labelIdsProp ?? EMPTY_LABEL_IDS;
  const [open, setOpen] = useState(false);
  const [draftCsStatus, setDraftCsStatus] = useState(csStatus);
  const [draftBookingStage, setDraftBookingStage] =
    useState<BookingStage | null>(bookingStage);
  const [draftReminderStatus, setDraftReminderStatus] =
    useState<QuickReminderStatus | null>(quickReminderStatus(reminder));
  const [draftLabelIds, setDraftLabelIds] = useState(labelIds);

  // Assignment, filing and notes are immediate operations rather than part of
  // the draft above: handing a thread to a colleague has happened the moment
  // it is confirmed, and pretending otherwise until "save" would leave two
  // employees believing different things about who owns it.
  const release = useReleaseConversation(conversationId);
  const transfer = useTransferConversation(conversationId);
  const routing = useSetConversationRouting(conversationId);
  const sectionMutation = useSetConversationSection(conversationId);
  const busy =
    release.isPending ||
    transfer.isPending ||
    routing.isPending ||
    sectionMutation.isPending;
  const immediateError =
    release.error?.message ??
    transfer.error?.message ??
    routing.error?.message ??
    sectionMutation.error?.message ??
    null;

  const holder = agents.find((agent) => agent.id === assignedTo);
  const mine = Boolean(assignedTo && assignedTo === myTeamMemberId);
  const canHandOff = isAdmin || mine;

  const selectedLabels = labels.filter((label) => draftLabelIds.includes(label.id));
  const reminderPreview = draftReminderStatus
    ? REMINDER_STATUS_LABEL[draftReminderStatus]
    : reminder
      ? REMINDER_STATUS_LABEL[reminder.status]
      : null;
  const dirty =
    draftCsStatus !== csStatus ||
    draftBookingStage !== bookingStage ||
    draftReminderStatus !== quickReminderStatus(reminder) ||
    !sameIds(draftLabelIds, labelIds);

  function openSheet() {
    setDraftCsStatus(csStatus);
    setDraftBookingStage(bookingStage);
    setDraftReminderStatus(quickReminderStatus(reminder));
    setDraftLabelIds(labelIds);
    tapFeedback();
    setOpen(true);
  }

  function closeSheet() {
    if (!pending) setOpen(false);
  }

  function toggleLabel(labelId: string) {
    tapFeedback();
    setDraftLabelIds((current) =>
      current.includes(labelId)
        ? current.filter((id) => id !== labelId)
        : [...current, labelId],
    );
  }

  return (
    <>
      <Pressable
        testID="conversation-actions-open"
        accessibilityRole="button"
        accessibilityLabel="إجراءات المحادثة"
        accessibilityHint="يفتح حالات المحادثة وتصنيفاتها"
        onPress={openSheet}
        style={({ pressed }) => ({
          width: hitSize.min,
          height: hitSize.min,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: colors.brand,
          backgroundColor: colors.brandSoft,
          opacity: pressed ? 0.72 : 1,
        })}
      >
        <IconSymbol name="pencil" color={colors.onBrandSoft} size={18} />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeSheet}
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
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ ...type.title3, color: colors.text, ...rtlText }}>
                إجراءات المحادثة
              </Text>
              <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
                الحالات والتصنيفات والمسؤولية
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
              accessibilityState={{ disabled: pending }}
              disabled={pending}
              onPress={closeSheet}
              style={({ pressed }) => ({
                width: hitSize.min,
                height: hitSize.min,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                backgroundColor: colors.surfaceSunken,
                opacity: pending ? 0.45 : pressed ? 0.6 : 1,
              })}
            >
              <IconSymbol name="xmark" color={colors.textSecondary} size={18} />
            </Pressable>
          </View>

          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            style={{ flex: 1 }}
            contentContainerStyle={{
              gap: spacing.xl,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.xl,
            }}
          >
            <ActionSection title="حالة التواصل">
              <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
                {CS_STATUS_OPTIONS.map((status) => (
                  <ChoiceChip
                    key={status}
                    testID={`conversation-actions-status-${status}`}
                    label={csStatusLabel[status]}
                    selected={draftCsStatus === status}
                    disabled={!canEdit || pending}
                    onPress={() => {
                      tapFeedback();
                      setDraftCsStatus(status);
                    }}
                  />
                ))}
              </View>
            </ActionSection>

            <ActionSection title="مرحلة متابعة الحجز">
              <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
                {bookingStages.map((stage) => (
                  <ChoiceChip
                    key={stage.id}
                    testID={`conversation-actions-booking-${stage.id}`}
                    label={stage.label}
                    selected={draftBookingStage === stage.id}
                    disabled={!canEdit || pending}
                    onPress={() => {
                      tapFeedback();
                      setDraftBookingStage(stage.id);
                    }}
                  />
                ))}
              </View>
            </ActionSection>

            {reminder ? (
              <ActionSection
                title="تأكيد الحضور"
                subtitle={formatters.shortDate.format(
                  new Date(`${reminder.dayKey}T12:00:00+03:00`),
                )}
              >
                <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
                  {(
                    [
                      { value: "confirmed", label: "أكدت الحضور" },
                      { value: "awaiting_reply", label: "لم تؤكد بعد" },
                    ] as const
                  ).map((option) => (
                    <ChoiceChip
                      key={option.value}
                      testID={`conversation-actions-reminder-${option.value}`}
                      label={option.label}
                      selected={draftReminderStatus === option.value}
                      disabled={!canEdit || pending}
                      onPress={() => {
                        tapFeedback();
                        setDraftReminderStatus(option.value);
                      }}
                    />
                  ))}
                </View>
              </ActionSection>
            ) : null}

            <ActionSection title="التصنيفات">
              {labels.length ? (
                <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
                  {labels.map((label) => {
                    const selected = draftLabelIds.includes(label.id);
                    return (
                      <Pressable
                        key={label.id}
                        testID={`conversation-actions-label-${label.id}`}
                        accessibilityRole="checkbox"
                        accessibilityLabel={label.name}
                        accessibilityState={{
                          checked: selected,
                          disabled: !canEdit || pending,
                        }}
                        disabled={!canEdit || pending}
                        onPress={() => toggleLabel(label.id)}
                        style={({ pressed }) => ({
                          minHeight: hitSize.min,
                          flexDirection: "row-reverse",
                          alignItems: "center",
                          gap: spacing.sm,
                          paddingHorizontal: spacing.md,
                          borderRadius: radius.full,
                          borderWidth: selected ? 1.5 : 1,
                          borderColor: selected ? colors.brand : colors.border,
                          backgroundColor: selected ? colors.brandSoft : colors.surface,
                          opacity: !canEdit ? 0.5 : pressed ? 0.72 : 1,
                        })}
                      >
                        <View
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: radius.full,
                            backgroundColor: labelColor(label.color, colors),
                          }}
                        />
                        <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
                          {label.name}
                        </Text>
                        {selected ? (
                          <IconSymbol name="checkmark" color={colors.onBrandSoft} size={14} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
                  لا توجد تصنيفات متاحة.
                </Text>
              )}
            </ActionSection>

            <View
              style={{
                gap: spacing.sm,
                padding: spacing.md,
                borderRadius: radius.lg,
                borderCurve: "continuous",
                backgroundColor: colors.surfaceSunken,
              }}
            >
              <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
                القيم التي سيتم حفظها
              </Text>
              <ReviewRow label="حالة التواصل" value={csStatusLabel[draftCsStatus]} />
              <ReviewRow
                label="مرحلة الحجز"
                value={
                  draftBookingStage
                    ? bookingStageLabel[draftBookingStage]
                    : "غير محددة"
                }
              />
              {reminderPreview ? (
                <ReviewRow label="تأكيد الحضور" value={reminderPreview} />
              ) : null}
              <ReviewRow
                label="التصنيفات"
                value={
                  selectedLabels.length
                    ? selectedLabels.map((label) => label.name).join("، ")
                    : "بدون تصنيفات"
                }
              />
            </View>

            <View
              style={{
                gap: spacing.xl,
                paddingTop: spacing.md,
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
            >
              <View style={{ gap: 2 }}>
                <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
                  إجراءات فورية
                </Text>
                <Text
                  style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}
                >
                  تُنفَّذ فور تأكيدها ولا تنتظر زر الحفظ.
                </Text>
              </View>

              {immediateError ? <InlineAlert message={immediateError} /> : null}

              <ActionSection
                title="المسؤولة عن المحادثة"
                subtitle={
                  assignedTo ? (mine ? "أنتِ" : agentName(holder)) : "غير مستلمة"
                }
              >
                <View
                  style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}
                >
                  {assignedTo && canHandOff ? (
                    <ChoiceChip
                      testID="conversation-actions-release"
                      label="إطلاق المحادثة"
                      selected={false}
                      disabled={busy}
                      onPress={() => {
                        tapFeedback();
                        Alert.alert(
                          "إطلاق المحادثة؟",
                          "ستعود إلى قائمة المحادثات غير المستلمة ليستلمها أي موظف.",
                          [
                            { text: "إلغاء", style: "cancel" },
                            {
                              text: "إطلاق",
                              style: "destructive",
                              onPress: () => release.mutate(undefined),
                            },
                          ],
                        );
                      }}
                    />
                  ) : null}
                  {canHandOff
                    ? agents
                        .filter((agent) => agent.id !== assignedTo)
                        .map((agent) => (
                          <ChoiceChip
                            key={agent.id}
                            testID={`conversation-actions-transfer-${agent.id}`}
                            label={`تحويل إلى ${agentName(agent)}`}
                            selected={false}
                            disabled={busy}
                            onPress={() => {
                              tapFeedback();
                              Alert.alert(
                                "تحويل المحادثة؟",
                                `ستنتقل المسؤولية إلى ${agentName(agent)}.`,
                                [
                                  { text: "إلغاء", style: "cancel" },
                                  {
                                    text: "تحويل",
                                    onPress: () => transfer.mutate(agent.id),
                                  },
                                ],
                              );
                            }}
                          />
                        ))
                    : null}
                  {!canHandOff ? (
                    <Text
                      style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}
                    >
                      استلمي المحادثة أولاً لتحويلها أو إطلاقها.
                    </Text>
                  ) : null}
                </View>
              </ActionSection>

              {/* Filing and exclusive routing are blunt: a routed thread
                  disappears from every other inbox, which is also what stops it
                  notifying anyone. Owner-only, exactly as on the web. */}
              {isAdmin ? (
                <>
                  <ActionSection title="قسم المحادثة">
                    <View
                      style={{
                        flexDirection: "row-reverse",
                        flexWrap: "wrap",
                        gap: spacing.sm,
                      }}
                    >
                      {SECTION_OPTIONS.map((option) => (
                        <ChoiceChip
                          key={option.label}
                          testID={`conversation-actions-section-${option.value ?? "none"}`}
                          label={option.label}
                          selected={(section ?? null) === option.value}
                          disabled={busy}
                          onPress={() => {
                            tapFeedback();
                            sectionMutation.mutate(option.value);
                          }}
                        />
                      ))}
                    </View>
                  </ActionSection>

                  <ActionSection
                    title="توجيه حصري"
                    subtitle="تظهر لهذه الموظفة وللمديرة فقط"
                  >
                    <View
                      style={{
                        flexDirection: "row-reverse",
                        flexWrap: "wrap",
                        gap: spacing.sm,
                      }}
                    >
                      <ChoiceChip
                        testID="conversation-actions-routing-none"
                        label="بدون توجيه"
                        selected={!routedTo}
                        disabled={busy}
                        onPress={() => {
                          tapFeedback();
                          routing.mutate(null);
                        }}
                      />
                      {agents.map((agent) => (
                        <ChoiceChip
                          key={agent.id}
                          testID={`conversation-actions-routing-${agent.id}`}
                          label={agentName(agent)}
                          selected={routedTo === agent.id}
                          disabled={busy}
                          onPress={() => {
                            tapFeedback();
                            routing.mutate(agent.id);
                          }}
                        />
                      ))}
                    </View>
                  </ActionSection>
                </>
              ) : null}

              <NotesSection conversationId={conversationId} enabled={open} />
            </View>

            {!canEdit ? (
              <InlineAlert
                tone="warning"
                message="استلمي المحادثة أولاً لتعديل حالاتها وتصنيفاتها."
              />
            ) : null}
            {error ? <InlineAlert message={error} /> : null}
          </ScrollView>

          <View
            style={{
              gap: spacing.sm,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.md,
              paddingBottom: spacing.md + insets.bottom,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <PrimaryButton
              testID="conversation-actions-save"
              label="حفظ إجراءات المحادثة"
              icon="checkmark"
              loading={pending}
              disabled={!canEdit || !dirty}
              onPress={() =>
                onSave(
                  {
                    csStatus: draftCsStatus,
                    bookingStage: draftBookingStage,
                    labelIds: draftLabelIds,
                    reminderConfirmation:
                      reminder && draftReminderStatus
                        ? {
                            dayKey: reminder.dayKey,
                            status: draftReminderStatus,
                          }
                        : null,
                  },
                  () => setOpen(false),
                )
              }
            />
            <PrimaryButton
              label="إلغاء"
              variant="plain"
              disabled={pending}
              silent
              onPress={closeSheet}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

/**
 * Internal notes — staff-only, never sent to the customer. Loaded only while
 * the sheet is open so closing it stops the polling along with the reading.
 */
function NotesSection({
  conversationId,
  enabled,
}: {
  conversationId: string;
  enabled: boolean;
}) {
  const { colors } = useTheme();
  const notes = useConversationNotes(conversationId, enabled);
  const addNote = useAddConversationNote(conversationId);
  const [draft, setDraft] = useState("");

  const submit = () => {
    const body = draft.trim();
    if (!body || addNote.isPending) return;
    tapFeedback();
    addNote.mutate(body, { onSuccess: () => setDraft("") });
  };

  return (
    <ActionSection title="ملاحظات داخلية" subtitle="لا تُرسل للعميلة">
      {notes.data?.notes.length ? (
        <View style={{ gap: spacing.sm }}>
          {notes.data.notes.map((note) => (
            <View
              key={note.id}
              style={{
                gap: 2,
                padding: spacing.md,
                borderRadius: radius.md,
                borderCurve: "continuous",
                backgroundColor: colors.surfaceSunken,
              }}
            >
              <Text selectable style={{ ...type.callout, color: colors.text, ...rtlText }}>
                {note.body}
              </Text>
              <Text
                style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}
              >
                {new Date(note.created_at).toLocaleString("ar-EG", {
                  day: "numeric",
                  month: "long",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
            </View>
          ))}
        </View>
      ) : notes.isLoading ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
          لا توجد ملاحظات بعد.
        </Text>
      )}

      {notes.isError ? <InlineAlert message={notes.error.message} /> : null}
      {addNote.isError ? <InlineAlert message={addNote.error.message} /> : null}

      <View style={{ flexDirection: "row-reverse", alignItems: "flex-end", gap: spacing.sm }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="أضيفي ملاحظة داخلية…"
          placeholderTextColor={colors.textTertiary}
          multiline
          editable={!addNote.isPending}
          style={{
            flex: 1,
            minHeight: hitSize.min,
            maxHeight: 120,
            paddingHorizontal: spacing.md,
            paddingTop: spacing.sm,
            paddingBottom: spacing.sm,
            borderRadius: radius.md,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            ...type.callout,
            color: colors.text,
            ...rtlText,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="حفظ الملاحظة"
          accessibilityState={{ disabled: !draft.trim() || addNote.isPending }}
          disabled={!draft.trim() || addNote.isPending}
          onPress={submit}
          style={{
            width: hitSize.min,
            height: hitSize.min,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.md,
            backgroundColor: colors.brand,
            opacity: !draft.trim() || addNote.isPending ? 0.5 : 1,
          }}
        >
          {addNote.isPending ? (
            <ActivityIndicator color={colors.onBrand} />
          ) : (
            <IconSymbol name="plus" color={colors.onBrand} size={18} />
          )}
        </Pressable>
      </View>
    </ActionSection>
  );
}

function ActionSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
        <Text style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function ChoiceChip({
  testID,
  label,
  selected,
  disabled,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitSize.min,
        flexDirection: "row-reverse",
        alignItems: "center",
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        borderRadius: radius.full,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colors.brand : colors.border,
        backgroundColor: selected ? colors.brandSoft : colors.surface,
        opacity: disabled ? 0.5 : pressed ? 0.72 : 1,
      })}
    >
      {selected ? (
        <IconSymbol name="checkmark" color={colors.onBrandSoft} size={14} />
      ) : null}
      <Text
        style={{
          ...type.subheadStrong,
          color: selected ? colors.onBrandSoft : colors.textSecondary,
          ...rtlText,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row-reverse",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: spacing.md,
      }}
    >
      <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
        {label}
      </Text>
      <Text
        selectable
        style={{ flex: 1, ...type.footnote, color: colors.text, ...rtlText }}
      >
        {value}
      </Text>
    </View>
  );
}

function labelColor(
  color: LabelColor,
  colors: ReturnType<typeof useTheme>["colors"],
) {
  return {
    slate: colors.textSecondary,
    red: colors.danger,
    amber: colors.warning,
    emerald: colors.success,
    blue: colors.info,
    indigo: colors.brand,
    fuchsia: colors.danger,
    rose: colors.danger,
  }[color];
}
