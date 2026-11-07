import {
  analyzeCustomerServiceAgent,
  type CustomerServiceAgentAnalysis,
} from "@/lib/customer-service-analysis";
import { OperationsReportInputError } from "@/lib/operations-report";
import { authorizeMobileRequest, mobileData, mobileError, mobileServerError } from "@/lib/mobile/http";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { KIARA_RESTAURANT_ID } from "@/lib/tenant";

export const maxDuration = 120;

/** How many saved reviews the screen gets: the latest plus the history list. */
const HISTORY_LIMIT = 10;

export type SavedAgentReport = {
  id: string;
  createdAt: string;
  from: string;
  to: string;
  startTime: string;
  endTime: string;
  analysis: CustomerServiceAgentAnalysis;
};

type ReportRow = {
  id: string;
  created_at: string;
  period_from: string;
  period_to: string;
  start_time: string;
  end_time: string;
  report: CustomerServiceAgentAnalysis;
};

const toSaved = (row: ReportRow): SavedAgentReport => ({
  id: row.id,
  createdAt: row.created_at,
  from: row.period_from,
  to: row.period_to,
  startTime: row.start_time,
  endTime: row.end_time,
  analysis: row.report,
});

const COLUMNS = "id, created_at, period_from, period_to, start_time, end_time, report";

/** GET ?personId= — her saved reviews, newest first. */
export async function GET(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (!auth.session.isOwner) {
    return mobileError(403, "OWNER_REQUIRED", "هذا التحليل متاح للمالكة فقط");
  }
  const personId = new URL(request.url).searchParams.get("personId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(personId)) {
    return mobileError(400, "INVALID_PERSON", "موظفة غير صالحة");
  }
  try {
    const { data, error } = await getAdminSupabaseClient()
      .from("agent_analysis_reports")
      .select(COLUMNS)
      .eq("restaurant_id", KIARA_RESTAURANT_ID)
      .eq("team_member_id", personId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) throw new Error(error.message);
    return mobileData({ reports: ((data ?? []) as ReportRow[]).map(toSaved) });
  } catch (error) {
    return mobileServerError(error, "AGENT_ANALYSIS_HISTORY_FAILED", "تعذّر تحميل التحليلات السابقة");
  }
}

export async function POST(request: Request) {
  const auth = await authorizeMobileRequest(request);
  if (auth.response) return auth.response;
  if (!auth.session.isOwner) {
    return mobileError(403, "OWNER_REQUIRED", "هذا التحليل متاح للمالكة فقط");
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const personId = String(body.personId ?? "");
  const input = {
    from: String(body.from ?? ""),
    to: String(body.to ?? ""),
    startTime: String(body.startTime ?? "00:00"),
    endTime: String(body.endTime ?? "23:59"),
  };
  try {
    const analysis = await analyzeCustomerServiceAgent(personId, input);
    if (!analysis) {
      return mobileError(422, "ANALYSIS_UNAVAILABLE", "لا توجد محادثات كافية للتحليل خلال الفترة المختارة أو خدمة الذكاء غير مفعّلة");
    }

    // Kept so the screen reopens on it. A failed save must not cost the owner
    // the review she just waited for, so it only loses the history entry.
    let report: SavedAgentReport | null = null;
    const { data, error } = await getAdminSupabaseClient()
      .from("agent_analysis_reports")
      .insert({
        restaurant_id: KIARA_RESTAURANT_ID,
        team_member_id: personId,
        requested_by: auth.session.teamMemberId,
        period_from: input.from,
        period_to: input.to,
        start_time: input.startTime,
        end_time: input.endTime,
        report: analysis,
        ai_unavailable: Boolean(analysis.aiUnavailable),
      })
      .select(COLUMNS)
      .single();
    if (error) console.error("[agent-analysis] save failed", error.message);
    else report = toSaved(data as ReportRow);

    return mobileData({ analysis, report });
  } catch (error) {
    if (error instanceof OperationsReportInputError) {
      return mobileError(400, "INVALID_REPORT_RANGE", error.message);
    }
    return mobileServerError(error, "AGENT_ANALYSIS_FAILED", "تعذّر تحليل أداء الموظفة");
  }
}
