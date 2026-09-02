import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import * as Crypto from "expo-crypto";

import {
  AI_TIMEOUT_MS,
  ApiError,
  apiRequest,
  apiUpload,
  SEND_TIMEOUT_MS,
  type UploadFile,
} from "@/lib/api";
import { fieldNotificationDeviceId } from "@/lib/notifications";
import type {
  BootstrapResponse,
  BookingReceipt,
  CatalogItem,
  ConversationActionsInput,
  ConversationDetail,
  ConversationMessagesPage,
  ConversationSummary,
  ConversationSection,
  ConversationFilters,
  ConversationsResponse,
  CreateOrderInput,
  CustomerAnalysisResult,
  CustomerServiceReport,
  ConversationAuditReport,
  CustomerTimeline,
  InboxView,
  DispatchInput,
  DispatchPreview,
  DispatchOptionsResponse,
  FieldSessionDashboard,
  FieldSessionState,
  FieldOrder,
  FieldOrderAction,
  FieldOrderListView,
  InternalNote,
  OrderDetailResponse,
  OrderPatch,
  OrderAuditLog,
  OrderReminderContext,
  OrderReminderDelivery,
  OrderSummary,
  OrdersResponse,
  OrdersCalendarResponse,
  OperationsReport,
  RekazCheckResponse,
  RekazPullResponse,
  SavedReply,
  SendOrderReminderInput,
  TripType,
} from "@/types/api";
import { publicApiRequest } from "@/lib/api";

export const queryKeys = {
  bootstrap: ["bootstrap"] as const,
  conversations: (
    view: InboxView,
    search: string,
    filters: ConversationFilters = EMPTY_CONVERSATION_FILTERS,
  ) =>
    [
      "conversations",
      view,
      search,
      filters.status ?? "",
      filters.section ?? "",
      filters.labelId ?? "",
      filters.bookingStage ?? "",
      filters.handling ?? "",
    ] as const,
  conversation: (id: string) => ["conversation", id] as const,
  conversationMessages: (id: string) => ["conversation-messages", id] as const,
  orders: (search: string) => ["orders", search] as const,
  ordersCalendar: (from: string, to: string) => ["orders-calendar", from, to] as const,
  operationsReport: (from: string, to: string, startTime: string, endTime: string) =>
    ["operations-report", from, to, startTime, endTime] as const,
  customerServiceReport: (from: string, to: string, startTime: string, endTime: string) =>
    ["customer-service-report", from, to, startTime, endTime] as const,
  rekazCheck: ["rekaz-check"] as const,
  order: (id: string) => ["order", id] as const,
  orderReminder: (id: string) => ["order-reminder", id] as const,
  dispatchOptions: ["dispatch-options"] as const,
  fieldSession: (token: string) => ["field-session", token] as const,
  fieldOrders: (view?: FieldOrderListView, dayStart?: string) =>
    ["field-orders", view ?? "all", dayStart ?? ""] as const,
  fieldOrder: (id: string) => ["field-order", id] as const,
  customerTimeline: (phone: string) => ["customer-timeline", phone] as const,
  conversationNotes: (id: string) => ["conversation-notes", id] as const,
  conversationAudit: (id: string) => ["conversation-audit", id] as const,
  orderAudit: (id: string) => ["order-audit", id] as const,
  catalog: ["catalog"] as const,
  mediaUrl: (path: string) => ["media-url", path] as const,
};

export function useBootstrap(enabled = true) {
  return useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => apiRequest<BootstrapResponse>("/bootstrap"),
    enabled,
    // Startup already has a bounded network deadline. Surface its retry action
    // instead of multiplying that wait behind an unexplained full-screen spinner.
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** No refinement beyond the open view — the inbox's resting state. */
export const EMPTY_CONVERSATION_FILTERS: ConversationFilters = {
  status: null,
  section: null,
  labelId: null,
  bookingStage: null,
  handling: null,
};

export function useConversations(
  view: InboxView,
  search = "",
  options: { enabled?: boolean; filters?: ConversationFilters } = {},
) {
  const filters = options.filters ?? EMPTY_CONVERSATION_FILTERS;
  return useInfiniteQuery({
    queryKey: queryKeys.conversations(view, search, filters),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        view,
        offset: String(pageParam),
        limit: "50",
      });
      if (search) params.set("q", search);
      if (filters.status) params.set("status", filters.status);
      if (filters.section) params.set("section", filters.section);
      if (filters.labelId) params.set("label", filters.labelId);
      if (filters.bookingStage) params.set("stage", filters.bookingStage);
      if (filters.handling) params.set("handling", filters.handling);
      return apiRequest<ConversationsResponse>(`/conversations?${params.toString()}`);
    },
    getNextPageParam: (lastPage) =>
      lastPage.conversations.nextOffset ?? undefined,
    enabled: options.enabled ?? true,
    // Keep results while only the search text changes. Reusing one tab's rows
    // after the employee switches views would briefly put ordinary customers
    // under the specialist tab (or vice versa) while the new request resolves.
    placeholderData: (previous, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      const sameViewAndFilters =
        previousKey?.[1] === view &&
        previousKey?.[3] === (filters.status ?? "") &&
        previousKey?.[4] === (filters.section ?? "") &&
        previousKey?.[5] === (filters.labelId ?? "") &&
        previousKey?.[6] === (filters.bookingStage ?? "") &&
        previousKey?.[7] === (filters.handling ?? "");
      return sameViewAndFilters ? previous : undefined;
    },
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

/** The thread history, newest page first and older pages on upward scroll. */
export function useConversationMessages(id: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.conversationMessages(id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "25" });
      if (pageParam) params.set("before", pageParam);
      return apiRequest<ConversationMessagesPage>(
        `/conversations/${id}/messages?${params.toString()}`,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextBefore ?? undefined,
    enabled: Boolean(id) && enabled,
  });
}

export function useTakeConversation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ conversation: ConversationSummary }>(`/conversations/${id}/take`, { method: "POST" }),
    onSuccess: async () => {
      // The open thread is awaited because the screen renders it: the reply
      // should be in the list before the composer clears. The inbox list is
      // behind that screen and only its preview line changes, so it refreshes
      // on its own — awaiting it meant every send also waited on a refetch of
      // every page of the inbox the employee had scrolled through.
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(id),
      });
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
      // The open thread is awaited because the screen renders it: the reply
      // should be in the list before the composer clears. The inbox list is
      // behind that screen and only its preview line changes, so it refreshes
      // on its own — awaiting it meant every send also waited on a refetch of
      // every page of the inbox the employee had scrolled through.
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(id),
      });
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
    retry: 2,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["conversations"] }),
  });
}

export function useReply(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string; idempotencyKey: string }) =>
      apiRequest<{ conversationId: string; messageId: string; deliveryStatus: string }>(`/conversations/${id}/reply`, {
        method: "POST",
        body: JSON.stringify({
          body: input.text,
          idempotencyKey: input.idempotencyKey,
        }),
      }),
    onSuccess: async () => {
      // The open thread is awaited because the screen renders it: the reply
      // should be in the list before the composer clears. The inbox list is
      // behind that screen and only its preview line changes, so it refreshes
      // on its own — awaiting it meant every send also waited on a refetch of
      // every page of the inbox the employee had scrolled through.
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversationMessages(id),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(id),
      });
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
      idempotencyKey: string;
    }) =>
      apiUpload<{
        conversationId: string;
        messageId: string | null;
        deliveryStatus: string;
      }>(`/conversations/${id}/media`, {
        file: input.file,
        ...(input.caption ? { caption: input.caption } : {}),
        ...(input.voiceNote ? { voiceNote: "true" } : {}),
        idempotencyKey: input.idempotencyKey,
      }, { timeoutMs: SEND_TIMEOUT_MS }),
    onSuccess: async () => {
      // The open thread is awaited because the screen renders it: the reply
      // should be in the list before the composer clears. The inbox list is
      // behind that screen and only its preview line changes, so it refreshes
      // on its own — awaiting it meant every send also waited on a refetch of
      // every page of the inbox the employee had scrolled through.
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.conversationMessages(id),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(id),
      });
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
export function useMediaUrl(path: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.mediaUrl(path ?? ""),
    queryFn: () =>
      apiRequest<{ url: string; expiresIn: number }>(
        `/media?path=${encodeURIComponent(path!)}`,
      ),
    enabled: Boolean(path) && enabled,
    staleTime: 50 * 60_000,
    gcTime: 55 * 60_000,
    retry: 1,
  });
}

/** Upload a receipt without sending it to the customer as a chat message. */
export function useSaveBookingReceipt(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: UploadFile) =>
      apiUpload<{ receipt: BookingReceipt }>(
        `/conversations/${id}/receipt`,
        { file },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(id),
      });
    },
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
      // The open thread is awaited because the screen renders it: the reply
      // should be in the list before the composer clears. The inbox list is
      // behind that screen and only its preview line changes, so it refreshes
      // on its own — awaiting it meant every send also waited on a refetch of
      // every page of the inbox the employee had scrolled through.
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(id),
      });
    },
  });
}

/**
 * Confirm the appointment from inside the chat.
 *
 * Creates the pending visit only — the caller then opens the dispatch screen,
 * where the exact driver and specialist messages are reviewed before anything
 * is sent. Creating the order also clears the assistant's booking request, so
 * the conversation is refetched alongside the order lists.
 */
export function useCreateConversationOrder(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrderInput) =>
      apiRequest<{ order: OrderSummary }>(`/conversations/${id}/orders`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["orders-calendar"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversation(id) }),
      ]);
    },
  });
}

/** Drop the assistant's booking request without booking anything. */
export function useDismissBookingRequest(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ ok: true }>(`/conversations/${id}/booking-request`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.conversation(id),
      });
    },
  });
}

/**
 * Save a canned reply written on the phone. The sheet reads its list from the
 * bootstrap payload, so that is what has to come back fresh.
 */
export function useCreateSavedReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; body: string }) =>
      apiRequest<{ savedReply: SavedReply }>("/saved-replies", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
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

export function useOperationsReport(
  from: string,
  to: string,
  startTime: string,
  endTime: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.operationsReport(from, to, startTime, endTime),
    queryFn: () => {
      const params = new URLSearchParams({ from, to, startTime, endTime });
      return apiRequest<OperationsReport>(`/reports/operations?${params.toString()}`);
    },
    enabled: enabled && Boolean(from && to && startTime && endTime),
    staleTime: 30_000,
  });
}

export function useCustomerServiceReport(
  from: string,
  to: string,
  startTime: string,
  endTime: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.customerServiceReport(from, to, startTime, endTime),
    queryFn: () => {
      const params = new URLSearchParams({ from, to, startTime, endTime });
      return apiRequest<CustomerServiceReport>(
        `/reports/customer-service?${params.toString()}`,
      );
    },
    enabled: enabled && Boolean(from && to && startTime && endTime),
    staleTime: 15_000,
    refetchInterval: 30_000,
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
    // Deliberately not awaited. `invalidateQueries` resolves only once every
    // active query has refetched, and react-query awaits this callback before
    // running the one passed to `mutate` — so awaiting it here held the
    // dispatch modal shut through a calendar refetch and an orders refetch
    // after the order already existed. The employee tapped طلب سائق and
    // watched nothing happen for several seconds. The lists catch up on their
    // own while she works in the modal.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["orders-calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
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
      // The agenda reads `orders-calendar`, which is a different key from
      // `orders` and is NOT covered by invalidating it — react-query matches
      // key arrays element by element, so "orders" never prefixes
      // "orders-calendar". Leaving it out is what let a card keep offering
      // "طلب سائق" for a minute after a driver had been assigned.
      void queryClient.invalidateQueries({ queryKey: ["orders-calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.order(id) });
    },
  });
}

export function useDispatchOrder(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ specialistVoice, doorPhoto, ...input }: DispatchInput) => {
      // The order and its notes are stored by the command, so the dispatch
      // itself cannot half-succeed. What can miss is a nudge: `driverSent` and
      // `specialistSent` are the WhatsApp copies, `notified` the push.
      type Result = {
        order: OrderDetailResponse["order"];
        driverSent: boolean;
        specialistSent: boolean | null;
        notified: boolean;
      };
      const idempotencyKey = Crypto.randomUUID();
      // Either attachment has to travel as multipart — the same deadline
      // either way, because it is the same send.
      if (specialistVoice || doorPhoto) {
        return apiUpload<Result>(
          `/orders/${id}/dispatch`,
          {
            specialistId: input.specialistId,
            driverId: input.driverId,
            customerLocation: input.customerLocation,
            driverMessage: input.driverMessage,
            specialistMessage: input.specialistMessage,
            expectedVersion: String(input.expectedVersion),
            idempotencyKey,
            ...(specialistVoice ? { specialistVoice } : {}),
            ...(doorPhoto ? { doorPhoto } : {}),
          },
          { timeoutMs: SEND_TIMEOUT_MS },
        );
      }
      return apiRequest<Result>(
        `/orders/${id}/dispatch`,
        {
          method: "POST",
          timeoutMs: SEND_TIMEOUT_MS,
          body: JSON.stringify({ ...input, idempotencyKey }),
        },
      );
    },
    // Same reason as above: the screen closes on send, and holding it open
    // for the refetches only makes a finished action look unfinished.
    onSuccess: () => {
      // The agenda's own key — see useUpdateOrder. Without it the card the
      // employee returns to still says "طلب سائق" after she has just sent one.
      void queryClient.invalidateQueries({ queryKey: ["orders-calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.order(id) });
    },
  });
}

/**
 * Where the visit stands plus the reminder text to open the composer with.
 *
 * Polled on the same cadence as the order itself: a field step confirmed on
 * the driver's phone should change what this screen says one refresh later,
 * not when the employee thinks to pull down.
 */
export function useOrderReminder(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.orderReminder(id),
    queryFn: () =>
      apiRequest<{ reminder: OrderReminderContext }>(`/orders/${id}/reminders`),
    enabled: Boolean(id) && enabled,
    refetchInterval: 20_000,
  });
}

export function useSendOrderReminder(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SendOrderReminderInput) =>
      apiRequest<{ delivery: OrderReminderDelivery }>(`/orders/${id}/reminders`, {
        method: "POST",
        // A WhatsApp send sits inside this one, and the server — not the
        // phone — decides when it has failed.
        timeoutMs: SEND_TIMEOUT_MS,
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orderReminder(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.order(id) });
    },
  });
}

export function useDispatchPreview(id: string) {
  return useMutation({
    mutationFn: (input: {
      specialistId: string;
      driverId: string;
      /** So the preview quotes the address about to be committed. */
      customerLocation: string;
      specialistNote: string;
      tripType: TripType;
    }) =>
      apiRequest<{ preview: DispatchPreview }>(`/orders/${id}/dispatch/preview`, {
        method: "POST",
        // Writes the specialist's copy in her own language, so a model call
        // sits in the middle of this one.
        timeoutMs: AI_TIMEOUT_MS,
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

function localDayBounds(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { dayStart: start.toISOString(), dayEnd: end.toISOString() };
}

export function useFieldOrders(view: FieldOrderListView = "today") {
  const { dayStart, dayEnd } = localDayBounds();
  const params = new URLSearchParams({ view });
  if (view !== "done") {
    params.set("dayStart", dayStart);
    params.set("dayEnd", dayEnd);
  }
  return useQuery({
    queryKey: queryKeys.fieldOrders(view, dayStart),
    queryFn: () =>
      apiRequest<{ orders: FieldOrder[] }>(`/field/orders?${params.toString()}`),
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
      // A driver taps these standing beside the car, often on one bar of
      // signal. He waits for his own order to update and nothing else — the
      // day's list behind it catches up on its own.
      void queryClient.invalidateQueries({ queryKey: ["field-orders"] });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.fieldOrder(id),
      });
    },
  });
}

export type FieldPushDeliverySummary = {
  attempted: number;
  accepted: number;
  delivered: number;
  pending: number;
  failed: number;
  errors: string[];
};

export function useFieldPushTest() {
  return useMutation({
    mutationFn: async () => {
      const deviceId = await fieldNotificationDeviceId();
      if (!deviceId) {
        throw new ApiError(
          "لا يوجد معرّف إشعارات مسجل لهذا الجهاز.",
          0,
          "NO_FIELD_DEVICE_ID",
        );
      }
      return apiRequest<{ delivery: FieldPushDeliverySummary }>("/field/push-test", {
        method: "POST",
        body: JSON.stringify({ deviceId }),
      });
    },
  });
}

/**
 * The owner's responsibility trail for one thread: who held it, for how long,
 * and what they did while they did. Admin-only on the server, so the caller
 * passes `enabled` from the session rather than letting an agent 403 on open.
 */
export function useConversationAudit(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.conversationAudit(id),
    queryFn: () => apiRequest<ConversationAuditReport>(`/conversations/${id}/audit`),
    enabled: Boolean(id) && enabled,
    staleTime: 60_000,
  });
}

/** Every action taken on one order, oldest first. */
export function useOrderAudit(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.orderAudit(id),
    queryFn: () => apiRequest<OrderAuditLog>(`/orders/${id}/audit`),
    enabled: Boolean(id) && enabled,
    staleTime: 60_000,
  });
}

/**
 * The in-app thread for a phone number, opened rather than handed to WhatsApp.
 *
 * Used by the order screens' message buttons for the driver and the
 * specialist: replying as the salon means replying in the app, and the roster
 * knows a number where the inbox needs a conversation id.
 */
export function useConversationForPhone() {
  return useMutation({
    mutationFn: (input: { phone: string; name?: string | null }) =>
      apiRequest<{ conversationId: string; created: boolean }>(
        "/conversations/by-phone",
        {
          method: "POST",
          body: JSON.stringify({ phone: input.phone, name: input.name ?? "" }),
        },
      ),
  });
}
