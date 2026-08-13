import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";

import { apiRequest } from "@/lib/api";
import type {
  BootstrapResponse,
  ConversationDetail,
  ConversationSummary,
  ConversationsResponse,
  CustomerAnalysisResult,
  CustomerTimeline,
  InboxView,
  DispatchInput,
  DispatchPreview,
  DispatchOptionsResponse,
  FieldSessionDashboard,
  FieldSessionState,
  FieldOrder,
  FieldOrderAction,
  OrderDetailResponse,
  OrderPatch,
  OrderSummary,
  OrdersResponse,
  OrdersCalendarResponse,
  RekazCheckResponse,
  RekazPullResponse,
  ReminderConfirmation,
  TripType,
} from "@/types/api";
import { publicApiRequest } from "@/lib/api";

export const queryKeys = {
  bootstrap: ["bootstrap"] as const,
  conversations: (view: InboxView, search: string) =>
    ["conversations", view, search] as const,
  conversation: (id: string) => ["conversation", id] as const,
  orders: (search: string) => ["orders", search] as const,
  ordersCalendar: (from: string, to: string) => ["orders-calendar", from, to] as const,
  rekazCheck: ["rekaz-check"] as const,
  order: (id: string) => ["order", id] as const,
  dispatchOptions: ["dispatch-options"] as const,
  fieldSession: (token: string) => ["field-session", token] as const,
  fieldOrders: ["field-orders"] as const,
  fieldOrder: (id: string) => ["field-order", id] as const,
  customerTimeline: (phone: string) => ["customer-timeline", phone] as const,
};

export function useBootstrap(enabled = true) {
  return useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => apiRequest<BootstrapResponse>("/bootstrap"),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useConversations(
  view: InboxView,
  search = "",
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.conversations(view, search),
    queryFn: () => {
      const params = new URLSearchParams({ view });
      if (search) params.set("q", search);
      return apiRequest<ConversationsResponse>(`/conversations?${params.toString()}`);
    },
    enabled: options.enabled ?? true,
    // Keeps the previous page on screen while a new search resolves, so the
    // list never blanks out between keystrokes.
    placeholderData: (previous) => previous,
    refetchInterval: 30_000,
  });
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: queryKeys.conversation(id),
    queryFn: () => apiRequest<ConversationDetail>(`/conversations/${id}`),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });
}

export function useTakeConversation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ conversation: ConversationSummary }>(`/conversations/${id}/take`, { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(id) }),
      ]);
    },
  });
}

/**
 * Admin override: move a conversation away from the employee holding it.
 *
 * Separate from `useTakeConversation` on purpose — that one claims an
 * unassigned thread, this one overrides a colleague and therefore refuses to
 * run without a reason, which is stored on the accountability event.
 */
export function useTakeOverConversation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      apiRequest<{
        conversation: ConversationSummary;
        previousAssignee: string | null;
      }>(`/conversations/${id}/takeover`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(id) }),
      ]);
    },
  });
}

export function useMarkConversationRead(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ conversationId: string; unreadCount: 0 }>(
        `/conversations/${id}/read`,
        { method: "POST" },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
  });
}

export function useReply(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      apiRequest<{ conversationId: string; messageId: string; deliveryStatus: string }>(`/conversations/${id}/reply`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(id) }),
      ]);
    },
  });
}

export function useUpdateReminderConfirmation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      dayKey: string;
      status: "awaiting_reply" | "confirmed";
    }) =>
      apiRequest<{ reminderConfirmation: ReminderConfirmation }>(
        `/conversations/${id}/reservation-follow-up`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(id) }),
      ]);
    },
  });
}

export function useOrders(search = "") {
  return useQuery({
    queryKey: queryKeys.orders(search),
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      const query = params.toString();
      return apiRequest<OrdersResponse>(query ? `/orders?${query}` : "/orders");
    },
    placeholderData: (previous) => previous,
    refetchInterval: 60_000,
  });
}

export function useOrdersCalendar(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.ordersCalendar(from, to),
    queryFn: () =>
      apiRequest<OrdersCalendarResponse>(`/orders/calendar?from=${from}&to=${to}`),
    enabled: Boolean(from && to),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * What a Rekaz pull would change. The server caches the upstream read for a
 * minute, so polling here costs the calendar nothing extra.
 */
export function useRekazCheck(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.rekazCheck,
    queryFn: () => apiRequest<RekazCheckResponse>("/rekaz/sync"),
    enabled: options.enabled ?? true,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    // Rekaz being unreachable is an integration warning, not a reason to
    // retry hard from every phone on the floor.
    retry: 1,
  });
}

/**
 * Raise the operational order for a Rekaz visit. Creates the pending visit
 * only — the caller then opens the dispatch confirmation, which is where the
 * exact outbound text is shown and edited.
 */
export function useCreateOrderFromReservation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reservationId: string) =>
      apiRequest<{ order: OrderSummary }>("/orders/from-reservation", {
        method: "POST",
        body: JSON.stringify({ reservationId }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders-calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
    },
  });
}

export function useRekazPull() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<RekazPullResponse>("/rekaz/sync", { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders-calendar"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rekazCheck }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
    },
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: queryKeys.order(id),
    queryFn: () => apiRequest<OrderDetailResponse>(`/orders/${id}`),
    enabled: Boolean(id),
    refetchInterval: 20_000,
  });
}

export function useAnalyzeOrder(id: string) {
  return useMutation({
    mutationFn: () =>
      apiRequest<{ analysis: CustomerAnalysisResult }>(`/orders/${id}/analysis`, {
        method: "POST",
      }),
  });
}

/**
 * One customer's whole record. The lifetime Rekaz lookup is a live upstream
 * call, so this is not polled — the screen refreshes on pull-to-refresh.
 */
export function useCustomerTimeline(phone: string) {
  return useQuery({
    queryKey: queryKeys.customerTimeline(phone),
    queryFn: () =>
      apiRequest<CustomerTimeline>(
        `/customers/${encodeURIComponent(phone)}/timeline`,
      ),
    enabled: Boolean(phone),
    staleTime: 2 * 60_000,
  });
}

export function useDispatchOptions() {
  return useQuery({
    queryKey: queryKeys.dispatchOptions,
    queryFn: () => apiRequest<DispatchOptionsResponse>("/dispatch-options"),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateOrder(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: OrderPatch) =>
      apiRequest<{ order: OrderDetailResponse["order"] }>(`/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...patch,
          idempotencyKey: Crypto.randomUUID(),
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.order(id) }),
      ]);
    },
  });
}

export function useDispatchOrder(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DispatchInput) =>
      apiRequest<{ order: OrderDetailResponse["order"] }>(
        `/orders/${id}/dispatch`,
        {
          method: "POST",
          body: JSON.stringify({
            ...input,
            idempotencyKey: Crypto.randomUUID(),
          }),
        },
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.order(id) }),
      ]);
    },
  });
}

export function useDispatchPreview(id: string) {
  return useMutation({
    mutationFn: (input: {
      specialistId: string;
      driverId: string;
      specialistNote: string;
      tripType: TripType;
    }) =>
      apiRequest<{ preview: DispatchPreview }>(`/orders/${id}/dispatch/preview`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

export function useFieldSession(token: string) {
  return useQuery({
    queryKey: queryKeys.fieldSession(token),
    queryFn: async () => {
      const response = await publicApiRequest<{
        dashboard: FieldSessionDashboard;
      }>(`/api/session/${encodeURIComponent(token)}`);
      return response.dashboard;
    },
    enabled: Boolean(token),
    refetchInterval: 30_000,
  });
}

export function useFieldSessionAction(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { orderId: string; action: "start" | "complete" }) =>
      publicApiRequest<{ ok: true; state: FieldSessionState }>(
        `/api/session/${encodeURIComponent(token)}`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.fieldSession(token) }),
  });
}

export function useFieldOrders() {
  return useQuery({
    queryKey: queryKeys.fieldOrders,
    queryFn: () => apiRequest<{ orders: FieldOrder[] }>("/field/orders"),
    refetchInterval: 30_000,
  });
}

export function useFieldOrder(id: string) {
  return useQuery({
    queryKey: queryKeys.fieldOrder(id),
    queryFn: () => apiRequest<{ order: FieldOrder }>(`/field/orders/${id}`),
    enabled: Boolean(id),
    refetchInterval: 20_000,
  });
}

export function useFieldOrderAction(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      action: FieldOrderAction;
      expectedVersion: number;
    }) =>
      apiRequest<{ order: FieldOrder }>(`/field/orders/${id}`, {
        method: "POST",
        body: JSON.stringify({
          action: input.action,
          expectedVersion: input.expectedVersion,
          idempotencyKey: Crypto.randomUUID(),
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.fieldOrders }),
        queryClient.invalidateQueries({ queryKey: queryKeys.fieldOrder(id) }),
      ]);
    },
  });
}
