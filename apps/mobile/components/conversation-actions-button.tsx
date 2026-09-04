import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { Image } from "expo-image";

import { PrimaryButton } from "@/components/primary-button";
import { InlineAlert } from "@/components/screen-state";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import {
  bookingStageLabel,
  csStatusLabel,
  formatters,
} from "@/lib/format";
import { MAX_UPLOAD_BYTES, formatMegabytes } from "@/lib/api";
import { tapFeedback } from "@/lib/haptics";
import {
  useAddConversationNote,
  useConversationNotes,
  useCreateConversationLabel,
  useMediaUrl,
  useReleaseConversation,
  useSaveBookingReceipt,
  useSetConversationRouting,
  useSetConversationSection,
  useTransferConversation,
} from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type {
  BookingStage,
  BookingReceipt,
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

type PendingReceipt = {
  uri: string;
  name: string;
  type: string;
  sizeBytes: number | null;
};

const EMPTY_LABEL_IDS: string[] = [];
const NEW_LABEL_COLORS: readonly LabelColor[] = [
  "slate",
  "amber",
  "emerald",
  "blue",
  "indigo",
  "red",
];
const LABEL_COLOR_NAME: Record<LabelColor, string> = {
  slate: "رمادي",
  red: "أحمر",
  amber: "ذهبي",
  emerald: "أخضر",
  blue: "أزرق",
  indigo: "نيلي",
  fuchsia: "فوشيا",
  rose: "وردي",
};
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
  bookingReceipt,
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
  bookingReceipt: BookingReceipt | null;
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
  const [draftReceipt, setDraftReceipt] = useState<PendingReceipt | null>(null);
  const [uploadedReceipt, setUploadedReceipt] = useState<{
    conversationId: string;
    previousPath: string | null;
    receipt: BookingReceipt;
  } | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState<LabelColor>("blue");
  const [newLabelError, setNewLabelError] = useState<string | null>(null);

  const receiptUpload = useSaveBookingReceipt(conversationId);
  const labelCreation = useCreateConversationLabel();
  const uploadedReceiptIsCurrent = Boolean(
    uploadedReceipt &&
      uploadedReceipt.conversationId === conversationId &&
      uploadedReceipt.previousPath === (bookingReceipt?.storagePath ?? null),
  );
  const savedReceipt = uploadedReceiptIsCurrent
    ? (uploadedReceipt?.receipt ?? null)
    : bookingReceipt;
  const receiptUrl = useMediaUrl(savedReceipt?.storagePath ?? null, open);

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
    !sameIds(draftLabelIds, labelIds) ||
    Boolean(draftBookingStage === "invoice_required" && draftReceipt);
  const receiptRequired = draftBookingStage === "invoice_required";
  const hasReceipt = Boolean(draftReceipt || savedReceipt);
  const saving = pending || receiptUpload.isPending || labelCreation.isPending;

  function openSheet() {
    setDraftCsStatus(csStatus);
    setDraftBookingStage(bookingStage);
    setDraftReminderStatus(quickReminderStatus(reminder));
    setDraftLabelIds(labelIds);
    setDraftReceipt(null);
    setReceiptError(null);
    setNewLabelName("");
    setNewLabelError(null);
    tapFeedback();
    setOpen(true);
  }

  function closeSheet() {
    if (!saving) setOpen(false);
  }

  function toggleLabel(labelId: string) {
    tapFeedback();
    setDraftLabelIds((current) =>
      current.includes(labelId)
        ? current.filter((id) => id !== labelId)
        : [...current, labelId],
    );
  }

  async function createInlineLabel() {
    const name = newLabelName.trim();
    if (!name || !canEdit || labelCreation.isPending) return;

    setNewLabelError(null);
    try {
      const { label } = await labelCreation.mutateAsync({
        name,
        color: newLabelColor,
      });
      setDraftLabelIds((current) =>
        current.includes(label.id) ? current : [...current, label.id],
      );
      setNewLabelName("");
      tapFeedback();
    } catch (error) {
      setNewLabelError(
        error instanceof Error ? error.message : "تعذّر إنشاء التصنيف.",
      );
    }
  }

  async function pickReceipt() {
    setReceiptError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/*", "application/pdf"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    if ((asset.size ?? 0) > MAX_UPLOAD_BYTES) {
      setReceiptError(
        `الفاتورة أكبر من الحد المسموح (${formatMegabytes(MAX_UPLOAD_BYTES)}).`,
      );
      return;
    }

    const mimeType = receiptMimeType(asset.name, asset.mimeType);
    if (!mimeType) {
      setReceiptError("الفاتورة يجب أن تكون صورة أو ملف PDF.");
      return;
    }
    tapFeedback();
    setDraftReceipt({
      uri: asset.uri,
      name: asset.name,
      type: mimeType,
      sizeBytes: asset.size ?? null,
    });
  }

  async function viewReceipt() {
    setReceiptError(null);
    try {
      if (draftReceipt) {
        await Linking.openURL(draftReceipt.uri);
        return;
      }
      if (!savedReceipt) return;
      const url =
        receiptUrl.data?.url ?? (await receiptUrl.refetch()).data?.url ?? null;
      if (!url) throw new Error("missing receipt URL");
      await Linking.openURL(url);
    } catch {
      setReceiptError("تعذّر فتح الفاتورة. حاولي مرة أخرى.");
    }
  }

  async function saveActions() {
    setReceiptError(null);
    let receipt = savedReceipt;
    if (receiptRequired && draftReceipt) {
      try {
        const response = await receiptUpload.mutateAsync({
          uri: draftReceipt.uri,
          name: draftReceipt.name,
          type: draftReceipt.type,
        });
        receipt = response.receipt;
        setUploadedReceipt({
          conversationId,
          previousPath: bookingReceipt?.storagePath ?? null,
          receipt: response.receipt,
        });
        setDraftReceipt(null);
      } catch {
        return;
      }
    }
    if (receiptRequired && !receipt) {
      setReceiptError("أرفقي صورة الفاتورة أو ملف PDF قبل الحفظ.");
      return;
    }

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
              accessibilityState={{ disabled: saving }}
              disabled={saving}
              onPress={closeSheet}
              style={({ pressed }) => ({
                width: hitSize.min,
                height: hitSize.min,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.full,
                backgroundColor: colors.surfaceSunken,
                opacity: saving ? 0.45 : pressed ? 0.6 : 1,
              })}
            >
              <IconSymbol name="xmark" color={colors.textSecondary} size={18} />
            </Pressable>
          </View>

          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
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
                    disabled={!canEdit || saving}
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
                    disabled={!canEdit || saving}
                    onPress={() => {
                      tapFeedback();
                      setDraftBookingStage(stage.id);
                      if (stage.id !== "invoice_required") {
                        setDraftReceipt(null);
                        setReceiptError(null);
                      }
                    }}
                  />
                ))}
              </View>
            </ActionSection>

            {receiptRequired || savedReceipt || draftReceipt ? (
              <ReceiptAttachmentField
                required={receiptRequired}
                draft={draftReceipt}
                saved={savedReceipt}
                previewUrl={
                  draftReceipt?.type.startsWith("image/")
                    ? draftReceipt.uri
                    : savedReceipt?.contentType.startsWith("image/")
                      ? (receiptUrl.data?.url ?? null)
                      : null
                }
                loadingPreview={receiptUrl.isFetching && !draftReceipt}
                disabled={!canEdit || saving}
                error={
                  receiptError ??
                  receiptUpload.error?.message ??
                  (receiptUrl.isError ? receiptUrl.error.message : null)
                }
                onPick={() => void pickReceipt()}
                onView={() => void viewReceipt()}
                onRemoveDraft={() => {
                  tapFeedback();
                  setDraftReceipt(null);
                  setReceiptError(null);
                }}
              />
            ) : null}

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
                      disabled={!canEdit || saving}
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
                          disabled: !canEdit || saving,
                        }}
                        disabled={!canEdit || saving}
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

              <View
                style={{
                  gap: spacing.sm,
                  paddingTop: spacing.sm,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                <Text style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}>
                  إضافة تصنيف جديد
                </Text>
                <View
                  style={{
                    flexDirection: "row-reverse",
                    alignItems: "center",
                    gap: spacing.sm,
                  }}
                >
                  <TextInput
                    testID="conversation-actions-new-label-name"
                    accessibilityLabel="اسم التصنيف الجديد"
                    value={newLabelName}
                    onChangeText={(value) => {
                      setNewLabelName(value);
                      if (newLabelError) setNewLabelError(null);
                    }}
                    placeholder="اكتبي اسم التصنيف…"
                    placeholderTextColor={colors.textTertiary}
                    maxLength={40}
                    returnKeyType="done"
                    editable={canEdit && !saving}
                    onSubmitEditing={() => void createInlineLabel()}
                    style={{
                      flex: 1,
                      minHeight: hitSize.min,
                      paddingHorizontal: spacing.md,
                      borderWidth: 1,
                      borderColor: newLabelError ? colors.danger : colors.borderStrong,
                      borderRadius: radius.md,
                      backgroundColor: colors.surface,
                      color: colors.text,
                      opacity: canEdit ? 1 : 0.5,
                      ...type.body,
                      ...rtlText,
                    }}
                  />
                  <Pressable
                    testID="conversation-actions-new-label-add"
                    accessibilityRole="button"
                    accessibilityLabel="إضافة التصنيف وتحديده"
                    accessibilityState={{
                      disabled:
                        !canEdit || !newLabelName.trim() || labelCreation.isPending,
                    }}
                    disabled={!canEdit || !newLabelName.trim() || labelCreation.isPending}
                    onPress={() => void createInlineLabel()}
                    style={({ pressed }) => ({
                      minWidth: hitSize.min,
                      minHeight: hitSize.min,
                      flexDirection: "row-reverse",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: spacing.xs,
                      paddingHorizontal: spacing.md,
                      borderRadius: radius.md,
                      backgroundColor: colors.brand,
                      opacity:
                        !canEdit || !newLabelName.trim()
                          ? 0.45
                          : pressed
                            ? 0.72
                            : 1,
                    })}
                  >
                    {labelCreation.isPending ? (
                      <ActivityIndicator color={colors.onBrand} size="small" />
                    ) : (
                      <IconSymbol name="plus" color={colors.onBrand} size={16} />
                    )}
                    <Text style={{ ...type.subheadStrong, color: colors.onBrand, ...rtlText }}>
                      إضافة
                    </Text>
                  </Pressable>
                </View>

                <View
                  accessibilityRole="radiogroup"
                  style={{
                    flexDirection: "row-reverse",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: spacing.sm,
                  }}
                >
                  <Text style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}>
                    اللون
                  </Text>
                  {NEW_LABEL_COLORS.map((color) => {
                    const selected = newLabelColor === color;
                    return (
                      <Pressable
                        key={color}
                        testID={`conversation-actions-new-label-color-${color}`}
                        accessibilityRole="radio"
                        accessibilityLabel={`لون ${LABEL_COLOR_NAME[color]}`}
                        accessibilityState={{ selected, disabled: !canEdit || saving }}
                        disabled={!canEdit || saving}
                        onPress={() => {
                          tapFeedback();
                          setNewLabelColor(color);
                        }}
                        hitSlop={4}
                        style={({ pressed }) => ({
                          width: hitSize.min,
                          height: hitSize.min,
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: radius.full,
                          borderWidth: selected ? 2 : 1,
                          borderColor: selected ? colors.brand : colors.border,
                          backgroundColor: selected ? colors.brandSoft : colors.surface,
                          opacity: !canEdit ? 0.5 : pressed ? 0.68 : 1,
                        })}
                      >
                        <View
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: radius.full,
                            backgroundColor: labelColor(color, colors),
                          }}
                        />
                      </Pressable>
                    );
                  })}
                </View>

                {newLabelError ? <InlineAlert message={newLabelError} /> : null}
              </View>
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
              {receiptRequired ? (
                <ReviewRow
                  label="الفاتورة"
                  value={
                    draftReceipt?.name ??
                    savedReceipt?.originalFilename ??
                    (hasReceipt ? "مرفقة" : "مطلوبة قبل الحفظ")
                  }
                />
              ) : null}
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
              loading={saving}
              disabled={!canEdit || !dirty || (receiptRequired && !hasReceipt)}
              onPress={() => void saveActions()}
            />
            <PrimaryButton
              label="إلغاء"
              variant="plain"
              disabled={saving}
              silent
              onPress={closeSheet}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

function ReceiptAttachmentField({
  required,
  draft,
  saved,
  previewUrl,
  loadingPreview,
  disabled,
  error,
  onPick,
  onView,
  onRemoveDraft,
}: {
  required: boolean;
  draft: PendingReceipt | null;
  saved: BookingReceipt | null;
  previewUrl: string | null;
  loadingPreview: boolean;
  disabled: boolean;
  error: string | null;
  onPick: () => void;
  onView: () => void;
  onRemoveDraft: () => void;
}) {
  const { colors } = useTheme();
  const hasFile = Boolean(draft || saved);
  const filename =
    draft?.name ?? saved?.originalFilename ?? (saved ? "فاتورة محفوظة" : null);
  const sizeBytes = draft?.sizeBytes ?? saved?.sizeBytes ?? null;
  const contentType = draft?.type ?? saved?.contentType ?? null;

  return (
    <ActionSection
      title="الفاتورة أو الإيصال"
      subtitle={draft ? "جاهزة للحفظ" : saved ? "محفوظة" : "مطلوبة"}
    >
      <View
        style={{
          gap: spacing.md,
          padding: spacing.md,
          borderRadius: radius.lg,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: required && !hasFile ? colors.warning : colors.border,
          backgroundColor: colors.surface,
        }}
      >
        {previewUrl ? (
          <Image
            source={{ uri: previewUrl }}
            alt="معاينة الفاتورة"
            contentFit="contain"
            transition={160}
            style={{
              width: "100%",
              aspectRatio: 16 / 9,
              borderRadius: radius.md,
              backgroundColor: colors.surfaceSunken,
            }}
          />
        ) : hasFile ? (
          <View
            style={{
              minHeight: 112,
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.sm,
              borderRadius: radius.md,
              backgroundColor: colors.surfaceSunken,
            }}
          >
            {loadingPreview && contentType?.startsWith("image/") ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <IconSymbol
                name={contentType === "application/pdf" ? "doc.text" : "photo"}
                color={colors.brand}
                size={30}
              />
            )}
            <Text
              selectable
              numberOfLines={2}
              style={{ ...type.footnote, color: colors.textSecondary, ...rtlText }}
            >
              {filename}
            </Text>
          </View>
        ) : (
          <View
            style={{
              minHeight: 92,
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.sm,
              borderRadius: radius.md,
              backgroundColor: colors.surfaceSunken,
            }}
          >
            <IconSymbol name="doc.text" color={colors.textTertiary} size={28} />
            <Text style={{ ...type.footnote, color: colors.textTertiary, ...rtlText }}>
              اختاري صورة واضحة أو ملف PDF
            </Text>
          </View>
        )}

        {filename ? (
          <View style={{ gap: 2 }}>
            <Text
              selectable
              numberOfLines={2}
              style={{ ...type.subheadStrong, color: colors.text, ...rtlText }}
            >
              {filename}
            </Text>
            <Text
              style={{ ...type.caption, color: colors.textTertiary, ...rtlText }}
            >
              {[contentType === "application/pdf" ? "PDF" : "صورة", formatReceiptSize(sizeBytes)]
                .filter(Boolean)
                .join(" • ")}
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
          {required ? (
            <Pressable
              testID="conversation-actions-receipt-pick"
              accessibilityRole="button"
              accessibilityLabel={hasFile ? "استبدال الفاتورة" : "اختيار الفاتورة"}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={onPick}
              style={({ pressed }) => ({
                minHeight: hitSize.min,
                flexDirection: "row-reverse",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                backgroundColor: colors.brand,
                opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
              })}
            >
              <IconSymbol name="plus" color={colors.onBrand} size={16} />
              <Text style={{ ...type.subheadStrong, color: colors.onBrand, ...rtlText }}>
                {hasFile ? "استبدال الملف" : "اختيار صورة أو PDF"}
              </Text>
            </Pressable>
          ) : null}

          {hasFile ? (
            <Pressable
              testID="conversation-actions-receipt-view"
              accessibilityRole="button"
              accessibilityLabel="عرض الفاتورة"
              onPress={onView}
              style={({ pressed }) => ({
                minHeight: hitSize.min,
                flexDirection: "row-reverse",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.sm,
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.borderStrong,
                backgroundColor: colors.surface,
                opacity: pressed ? 0.68 : 1,
              })}
            >
              <IconSymbol name="eye" color={colors.brand} size={16} />
              <Text style={{ ...type.subheadStrong, color: colors.brand, ...rtlText }}>
                عرض
              </Text>
            </Pressable>
          ) : null}

          {draft ? (
            <Pressable
              testID="conversation-actions-receipt-remove"
              accessibilityRole="button"
              accessibilityLabel="إزالة الفاتورة المختارة"
              disabled={disabled}
              onPress={onRemoveDraft}
              style={({ pressed }) => ({
                minHeight: hitSize.min,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: spacing.md,
                borderRadius: radius.md,
                opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ ...type.subheadStrong, color: colors.danger, ...rtlText }}>
                إزالة
              </Text>
            </Pressable>
          ) : null}
        </View>

        {required && !hasFile ? (
          <Text style={{ ...type.footnote, color: colors.warning, ...rtlText }}>
            إرفاق الفاتورة مطلوب قبل حفظ هذه المرحلة.
          </Text>
        ) : null}
        {error ? <InlineAlert message={error} /> : null}
      </View>
    </ActionSection>
  );
}

function receiptMimeType(filename: string, provided?: string | null) {
  const mime = provided?.toLowerCase().split(";").at(0)?.trim();
  if (mime === "application/pdf" || mime?.startsWith("image/")) return mime;

  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "heic" || extension === "heif") return "image/heic";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  return null;
}

function formatReceiptSize(sizeBytes: number | null) {
  if (!sizeBytes || sizeBytes < 1) return "";
  if (sizeBytes < 1024 * 1024) return `${Math.ceil(sizeBytes / 1024)} كيلوبايت`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} ميجابايت`;
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
