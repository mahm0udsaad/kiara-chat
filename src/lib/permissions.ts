/**
 * Owner-granted extra permissions, per team member — the vocabulary.
 *
 * Role alone (`admin` / `agent`) already decides most of what an employee can
 * touch. This is for the handful of actions that are too destructive to hand
 * out by role but that the owner may still want a specific, trusted employee
 * to have — starting with deleting a message from the inbox.
 *
 * Pure constants only, importable from client components (the team screen's
 * permission toggles). The actual grant storage — which touches
 * `getAdminSupabaseClient`, a server-only module — lives in
 * `@/lib/permissions-store`.
 */
export const GRANTABLE_PERMISSIONS = {
  deleteMessages: "delete_messages",
} as const;

export type PermissionKey =
  (typeof GRANTABLE_PERMISSIONS)[keyof typeof GRANTABLE_PERMISSIONS];

export const PERMISSION_LABEL: Record<PermissionKey, string> = {
  [GRANTABLE_PERMISSIONS.deleteMessages]: "حذف الرسائل من المحادثات",
};

export function isPermissionKey(value: string): value is PermissionKey {
  return (Object.values(GRANTABLE_PERMISSIONS) as string[]).includes(value);
}
