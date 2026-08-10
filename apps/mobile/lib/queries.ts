import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@/lib/api";
import type {
  BootstrapResponse,
  ConversationDetail,
  ConversationSummary,
  ConversationsResponse,
  InboxView,
  DispatchInput,
  DispatchOptionsResponse,
  FieldSessionDashboard,
  FieldSessionState,
  OrderDetailResponse,
  OrderPatch,
  OrdersResponse,
} from "@/types/api";
import { publicApiRequest } from "@/lib/api";

export const queryKeys = {
  bootstrap: ["bootstrap"] as const,
  conversations: (view: InboxView, search: string) =>
    ["conversations", view, search] as const,
  conversation: (id: string) => ["conversation", id] as const,
  orders: (search: string) => ["orders", search] as const,
  order: (id: string) => ["order", id] as const,
  dispatchOptions: ["dispatch-options"] as const,
  fieldSession: (token: string) => ["field-session", token] as const,
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

export function useOrder(id: string) {
  return useQuery({
    queryKey: queryKeys.order(id),
    queryFn: () => apiRequest<OrderDetailResponse>(`/orders/${id}`),
    enabled: Boolean(id),
    refetchInterval: 20_000,
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
        body: JSON.stringify(patch),
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
        { method: "POST", body: JSON.stringify(input) },
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.order(id) }),
      ]);
    },
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
