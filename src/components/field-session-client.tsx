"use client";

import { useCallback, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  MapPin,
  Play,
  Square,
  UserRound,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import type {
  FieldSessionAction,
  FieldSessionDashboard,
} from "@/lib/field-session";
import { TRIP_TYPE_LABEL } from "@/lib/format";
import type { FieldSessionState } from "@/lib/types";

const DAY = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Asia/Riyadh",
});
const TIME = new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Riyadh",
});

export function FieldSessionClient({
  token,
  initialDashboard,
}: {
  token: string;
  initialDashboard: FieldSessionDashboard;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const specialist = dashboard.role === "specialist";

  const update = useCallback(
    async (orderId: string, action: FieldSessionAction) => {
      setBusy(`${orderId}:${action}`);
      setError(null);
      try {
        const response = await fetch(`/api/session/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, action }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error ?? "تعذّر تحديث الجلسة");
        setDashboard((current) => ({
          ...current,
          visits: current.visits.map((visit) =>
            visit.id === orderId
              ? { ...visit, state: data.state as FieldSessionState }
              : visit
          ),
        }));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "تعذّر تحديث الجلسة");
      } finally {
        setBusy(null);
      }
    },
    [token]
  );

  return (
    <main className="mx-auto min-h-svh max-w-xl px-4 py-6">
      <header className="mb-5 flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">كيارا</p>
        <h1 className="text-2xl font-semibold">مرحباً {dashboard.personName}</h1>
        <p className="text-sm text-muted-foreground">
          {specialist
            ? "اختاري الجلسة ثم أكدي بدايتها وانتهاءها."
            : "اختَر الرحلة ثم أكد بدايتها وانتهاءها."}
        </p>
      </header>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {dashboard.visits.length ? (
        <ul className="flex flex-col gap-3">
          {dashboard.visits.map((visit) => {
            const completed = Boolean(visit.state.completed_at);
            const started = Boolean(visit.state.started_at);
            const locationIsLink = /^https?:\/\//i.test(visit.customerLocation.trim());
            const isBusy = busy?.startsWith(`${visit.id}:`) ?? false;
            return (
              <li key={visit.id}>
                <Card>
                  <CardHeader>
                    <CardTitle>{DAY.format(new Date(visit.arrivalAt))}</CardTitle>
                    <CardDescription>
                      {TIME.format(new Date(visit.arrivalAt))} · {visit.durationMinutes} دقيقة
                    </CardDescription>
                    <Badge variant={completed ? "default" : started ? "secondary" : "outline"}>
                      {completed ? "تم الانتهاء" : started ? "جارية الآن" : "لم تبدأ"}
                    </Badge>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3 text-sm">
                    <p className="flex items-center gap-2">
                      <UserRound aria-hidden="true" />
                      {visit.customerName ?? "العميلة"} · <span dir="ltr">{visit.customerPhone}</span>
                    </p>
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Clock3 aria-hidden="true" />
                      {specialist
                        ? `السائق: ${visit.driverName ?? "غير محدد"}`
                        : `الأخصائية: ${visit.specialistName ?? "غير محددة"}`} ·{" "}
                      {TRIP_TYPE_LABEL[visit.tripType]}
                    </p>
                    {locationIsLink ? (
                      <Button variant="outline" asChild>
                        <a
                          href={visit.customerLocation.trim()}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <MapPin data-icon="inline-start" />
                          فتح موقع العميلة
                          <ExternalLink data-icon="inline-end" />
                        </a>
                      </Button>
                    ) : (
                      <p className="flex items-start gap-2">
                        <MapPin aria-hidden="true" />
                        {visit.customerLocation}
                      </p>
                    )}
                  </CardContent>
                  <CardFooter>
                    {completed ? (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 aria-hidden="true" /> تم تسجيل البداية والانتهاء
                      </p>
                    ) : started ? (
                      <Button
                        className="w-full"
                        onClick={() => update(visit.id, "complete")}
                        disabled={isBusy}
                      >
                        {isBusy ? <Spinner data-icon="inline-start" /> : <Square data-icon="inline-start" />}
                        {specialist ? "تأكيد انتهاء الجلسة" : "تأكيد انتهاء الرحلة"}
                      </Button>
                    ) : (
                      <Button
                        className="w-full"
                        onClick={() => update(visit.id, "start")}
                        disabled={isBusy}
                      >
                        {isBusy ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
                        {specialist ? "تأكيد بدء الجلسة" : "تأكيد بدء الرحلة"}
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCircle2 />
            </EmptyMedia>
            <EmptyTitle>لا توجد جلسات قادمة</EmptyTitle>
            <EmptyDescription>ستظهر هنا الجلسات المخصصة لك عند تأكيدها.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </main>
  );
}
