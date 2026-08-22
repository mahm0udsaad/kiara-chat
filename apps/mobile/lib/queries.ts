import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as Crypto from "expo-crypto";

import { ApiError, apiRequest, apiUpload, type UploadFile } from "@/lib/api";
import type {
  BootstrapResponse,
  CatalogItem,
  ConversationActionsInput,
  ConversationDetail,
  ConversationSummary,
  ConversationSection,
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
  InternalNote,
  OrderDetailResponse,
  OrderPatch,
  OrderSummary,
  OrdersResponse,
  OrdersCalendarResponse,
  RekazCheckResponse,
  RekazPullResponse,
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
  conversationNotes: (id: string) => ["conversation-notes", id] as const,
  catalog: ["catalog"] as const,
  mediaUrl: (path: string) => ["media-url", path] as const,
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
  return useInfiniteQuery({
    queryKey: queryKeys.conversations(view, search),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        view,
        offset: String(pageParam),
        limit: "50",
      });
      if (search) params.set("q", search);
      return apiRequest<ConversationsResponse>(`/conversations?${params.toString()}`);
    },
    getNextPageParam: (lastPage) =>
      lastPage.conversations.nextOffset ?? undefined,
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

/**
 * Send one attachment — a photo, a document, or a voice note.
 *
 * `voiceNote` is what turns an audio file into a WhatsApp push-to-talk bubble
 * rather than a plain audio attachment, so it is set only for something the
 * microphone just captured.
 */
export function useSendMedia(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      file: UploadFile;
      caption?: string;
      voiceNote?: boolean;
    }) =>
      apiUpload<{
        conversationId: string;
        messageId: string | null;
        deliveryStatus: string;
      }>(`/conversations/${id}/media`, {
        file: input.file,
        ...(input.caption ? { caption: input.caption } : {}),
        ...(input.voiceNote ? { voiceNote: "true" } : {}),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(id) }),
      ]);
    },
  });
}

/** The services and packages the composer can drop into a reply. */
export function useCatalog(enabled = true) {
  return useQuery({
    queryKey: queryKeys.catalog,
    queryFn: () => apiRequest<{ items: CatalogItem[] }>("/catalog"),
    enabled,
    // The price list changes a few times a year, not a few times an hour.
    staleTime: 30 * 60_000,
  });
}

/**
 * A signed URL for one stored attachment. The signature lasts an hour, so the
 * cache is held just under that and never refetched in the background — a
 * thread being re-read should not re-sign every photo in it.
 */
export function useMediaUrl(path: string | null) {
  return useQuery({
    queryKey: queryKeys.mediaUrl(path ?? ""),
    queryFn: () =>
      apiRequest<{ url: string; expiresIn: number }>(
        `/media?path=${encodeURIComponent(path!)}`,
      ),
    enabled: Boolean(path),
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
    retry: 1,
  });
}

export function useUpdateConversationActions(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConversationActionsInput) =>
      apiRequest<{ ok: true }>(`/conversations/${id}/actions`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
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
    // A disconnected Rekaz account stays disconnected until someone fixes it
    // on the server, so polling it every five minutes is a login attempt per
    // phone per five minutes against an account that can be locked out.
    refetchInterval: (query) =>
      isRekazAuthError(query.state.error) ? false : 5 * 60_000,
    // Rekaz being unreachable is an integration warning, not a reason to
    // retry hard from every phone on the floor.
    retry: (failureCount, error) =>
      !isRekazAuthError(error) && failureCount < 1,
  });
}

/** A Rekaz failure a retry cannot fix — the salon account needs reconnecting. */
const isRekazAuthError = (error: unknown) =>
  error instanceof ApiError && error.code === "REKAZ_AUTH_REQUIRED";

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

/**
 * Everything the actions sheet can do to a conversation beyond its editable
 * fields. These are immediate operations, not part of the sheet's draft: an
 * employee who hands a thread to a colleague has handed it over, whether or
 * not she then presses save.
 */
function useConversationMutation<TVariables>(
  id: string,
  request: (variables: TVariables) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(id) }),
        queryClient.invalidateQueries({ queryKey: ["conversations"] }),
      ]);
    },
  });
}

/** Hand the thread back to the unassigned queue. */
export function useReleaseConversation(id: string) {
  return useConversationMutation(id, () =>
    apiRequest<{ conversation: ConversationSummary }>(
      `/conversations/${id}/release`,
      { method: "POST" },
    ),
  );
}

/** Hand the thread to a named colleague. */
export function useTransferConversation(id: string) {
  return useConversationMutation(id, (targetTeamMemberId: string) =>
    apiRequest<{ conversation: ConversationSummary }>(
      `/conversations/${id}/transfer`,
      {
        method: "POST",
        body: JSON.stringify({ targetTeamMemberId }),
      },
    ),
  );
}

/** Owner-only: route the thread to one employee, or clear the route. */
export function useSetConversationRouting(id: string) {
  return useConversationMutation(id, (targetTeamMemberId: string | null) =>
    apiRequest<{ conversation: ConversationSummary }>(
      `/conversations/${id}/routing`,
      {
        method: "PUT",
        body: JSON.stringify({ targetTeamMemberId }),
      },
    ),
  );
}

/** Owner-only: file the thread under a section, or clear it. */
export function useSetConversationSection(id: string) {
  return useConversationMutation(id, (section: ConversationSection | null) =>
    apiRequest<{ conversation: ConversationSummary }>(
      `/conversations/${id}/section`,
      {
        method: "PUT",
        body: JSON.stringify({ section }),
      },
    ),
  );
}

/** Internal notes — staff-only, never sent to the customer. */
export function useConversationNotes(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.conversationNotes(id),
    queryFn: () =>
      apiRequest<{ notes: InternalNote[] }>(`/conversations/${id}/notes`),
    enabled: Boolean(id) && enabled,
    staleTime: 30_000,
  });
}

export function useAddConversationNote(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      apiRequest<{ note: InternalNote }>(`/conversations/${id}/notes`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversationNotes(id),
      });
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

/**
 * The AI read of one customer's experience, from her profile.
 *
 * A mutation rather than a query on purpose: it costs a model call, so it
 * happens when an employee asks for it and never on screen open.
 */
export function useAnalyzeCustomer(phone: string) {
  return useMutation({
    mutationFn: () =>
      apiRequest<{ analysis: CustomerAnalysisResult }>(
        `/customers/${encodeURIComponent(phone)}/analysis`,
        { method: "POST" },
      ),
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
        // The profile renders her visits, not her chat: asking for the
        // timeline without messages keeps the response to what it shows.
        `/customers/${encodeURIComponent(phone)}/timeline?messages=0`,
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
