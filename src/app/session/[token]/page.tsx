import { FieldSessionClient } from "@/components/field-session-client";
import { getFieldSessionDashboard } from "@/lib/field-session";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function FieldSessionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let dashboard = null;
  let errorMessage = "";
  try {
    dashboard = await getFieldSessionDashboard(token);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "الرابط غير صحيح أو منتهي";
  }
  if (!dashboard) {
    return (
      <main className="mx-auto flex min-h-svh max-w-md items-center px-4 py-10">
        <div className="w-full rounded-xl border bg-card p-6 text-center text-card-foreground">
          <h1 className="text-lg font-semibold">تعذّر فتح جدول الجلسات</h1>
          <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
        </div>
      </main>
    );
  }
  return <FieldSessionClient token={token} initialDashboard={dashboard} />;
}
