import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PrimaryButton } from "@/components/primary-button";
import { Field, TextAreaField } from "@/components/ui/field";
import { useTheme } from "@/providers/theme-provider";
import { spacing, type, rtlText } from "@/constants/theme";
import { apiRequest, ApiError } from "@/lib/api";
import type {
  ServiceChangeList,
  ServiceChangePreview,
} from "../../../src/lib/service-change-types";
const time = (value: string) =>
  new Date(value).toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
export function OrderServiceChanges({ orderId }: { orderId: string }) {
  const { colors } = useTheme();
  const cache = useQueryClient();
  const [preview, setPreview] = useState<ServiceChangePreview | null>(null);
  const [manual, setManual] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [notice, setNotice] = useState("");
  const endpoint = `/orders/${orderId}/services`;
  const query = useQuery({
    queryKey: ["order-services", orderId],
    queryFn: () => apiRequest<ServiceChangeList>(endpoint),
    refetchInterval: 30_000,
  });
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest<ServiceChangePreview>(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setPreview(null);
    },
    onSuccess: async (data, body) => {
      if (body.action === "preview") setPreview(data);
      else {
        setPreview(null);
        setManual(false);
        setNotice(
          body.action === "approve"
            ? "تم اعتماد الخدمة وتحديث الوقت. الإشعارات قيد الإرسال."
            : "تم استبعاد الاقتراح.",
        );
        await cache.invalidateQueries();
      }
    },
  });
  if (
    query.error instanceof ApiError &&
    (query.error.status === 404 || query.error.status === 503)
  ) {
    return null;
  }
  const text = { ...type.callout, color: colors.text, ...rtlText };
  const list = query.data;
  return (
    <View style={{ gap: spacing.md }}>
      <Text style={{ ...type.headline, color: colors.text, ...rtlText }}>
        خدمات الزيارة
      </Text>
      {notice ? <Text style={text}>{notice}</Text> : null}
      {query.isPending ? <Text style={text}>جارٍ تحميل الخدمات…</Text> : null}
      {query.error || mutation.error ? (
        <Text
          accessibilityRole="alert"
          style={{ ...text, color: colors.danger }}
        >
          {(mutation.error ?? query.error)?.message}
        </Text>
      ) : null}
      <PrimaryButton
        label="تحديث الخدمات وحالة الإشعارات"
        variant="outline"
        onPress={() => void query.refetch()}
      />
      {list ? (
        <>
          {list.services.map((s) => (
            <View key={s.id}>
              <Text style={text}>
                {s.name} · {s.minutes} دقيقة ·{" "}
                {s.sourceId ? `ركاز #${s.sourceId}` : "إضافة يدوية"}
              </Text>
              {!s.sourceId && list.canAdd && !preview ? (
                <PrimaryButton
                  label="تعديل الخدمة"
                  variant="plain"
                  onPress={() => {
                    setEditingId(s.id);
                    setName(s.name);
                    setMinutes(String(s.minutes));
                    setManual(true);
                  }}
                />
              ) : null}
            </View>
          ))}
          <Text style={text}>
            آخر مزامنة: {list.syncedAt ? time(list.syncedAt) : "لم تتم بعد"}
          </Text>
          {!list.canAdd ? (
            <Text style={text}>
              الإضافة متاحة بعد إرسال الطلب للأخصائية والسائق وقبل إنهاء
              الزيارة.
            </Text>
          ) : null}
          {list.canAdd && !preview ? (
            <>
              {list.candidates.map((c) => (
                <View key={c.sourceId} style={{ gap: spacing.sm }}>
                  <Text style={text}>
                    {c.kind === "update"
                      ? "تعديل في ركاز"
                      : "خدمة محتملة من ركاز"}
                    : {c.name} · {c.minutes} دقيقة
                  </Text>
                  <Text style={text}>{c.reasons.join(" · ")}</Text>
                  <PrimaryButton
                    label="مراجعة واعتماد"
                    variant="outline"
                    disabled={mutation.isPending}
                    onPress={() =>
                      mutation.mutate({
                        action: "preview",
                        sourceId: c.sourceId,
                      })
                    }
                  />
                  {list.services
                    .filter((s) => !s.sourceId)
                    .map((s) => (
                      <PrimaryButton
                        key={s.id}
                        label={`ربط بالخدمة اليدوية «${s.name}» دون زيادة الوقت`}
                        variant="outline"
                        disabled={mutation.isPending}
                        onPress={() =>
                          mutation.mutate({
                            action: "preview",
                            sourceId: c.sourceId,
                            serviceId: s.id,
                            reconcile: true,
                          })
                        }
                      />
                    ))}
                  <PrimaryButton
                    label="إبقاء كطلب مستقل"
                    variant="plain"
                    disabled={mutation.isPending}
                    onPress={() =>
                      mutation.mutate({
                        action: "dismiss",
                        sourceId: c.sourceId,
                      })
                    }
                  />
                </View>
              ))}
              <PrimaryButton
                label="إضافة خدمة يدويًا"
                variant="outline"
                onPress={() => {
                  setEditingId(null);
                  setName("");
                  setMinutes("30");
                  setManual(!manual);
                }}
              />
              {manual ? (
                <>
                  <Text style={text}>
                    تُنفّذ بعد الخدمات الحالية بواسطة الأخصائية المسندة. لا
                    تُنشئ فاتورة في ركاز.
                  </Text>
                  <Field
                    label="الخدمة"
                    value={name}
                    maxLength={300}
                    onChangeText={setName}
                  />
                  <Field
                    label="المدة بالدقائق"
                    value={minutes}
                    keyboardType="number-pad"
                    onChangeText={setMinutes}
                  />
                  <PrimaryButton
                    label="حساب الوقت ومراجعة الإشعارات"
                    loading={mutation.isPending}
                    disabled={!name.trim()}
                    onPress={() =>
                      mutation.mutate({
                        action: "preview",
                        name,
                        minutes: Number(minutes),
                        serviceId: editingId,
                      })
                    }
                  />
                </>
              ) : null}
            </>
          ) : null}
          {list.notifications.map((n) => (
            <Text key={n.id} style={text}>
              {n.role === "driver" ? "السائق" : "الأخصائية"}:{" "}
              {n.status === "accepted"
                ? "قُبل الإشعار للإرسال"
                : n.status === "failed"
                  ? "تعذّر إرسال الإشعار؛ راجعي وصوله مع الفريق"
                  : "الإشعار قيد الإرسال"}
            </Text>
          ))}
        </>
      ) : null}
      {preview ? (
        <>
          <Text style={text}>
            {preview.name} · {preview.minutes} دقيقة
          </Text>
          <Text style={text}>
            الانتهاء: {time(preview.oldEnd)} ← {time(preview.newEnd)}. فرق
            الانتظار: {preview.extensionMinutes} دقيقة.
          </Text>
          <TextAreaField
            label={`${preview.specialistTitle} — نص الأخصائية`}
            value={preview.specialistMessage}
            maxLength={2000}
            onChangeText={(value) =>
              setPreview({ ...preview, specialistMessage: value })
            }
          />
          <TextAreaField
            label={`${preview.driverTitle} — نص السائق`}
            value={preview.driverMessage}
            maxLength={2000}
            onChangeText={(value) =>
              setPreview({ ...preview, driverMessage: value })
            }
          />
          <PrimaryButton
            label="اعتماد الخدمة وإبلاغ الأخصائية والسائق"
            loading={mutation.isPending}
            disabled={
              !preview.specialistMessage.trim() || !preview.driverMessage.trim()
            }
            onPress={() =>
              mutation.mutate({
                action: "approve",
                previewId: preview.id,
                specialistMessage: preview.specialistMessage,
                driverMessage: preview.driverMessage,
              })
            }
          />
          <PrimaryButton
            label="رجوع للتعديل"
            variant="plain"
            disabled={mutation.isPending}
            onPress={() => setPreview(null)}
          />
        </>
      ) : null}
    </View>
  );
}
