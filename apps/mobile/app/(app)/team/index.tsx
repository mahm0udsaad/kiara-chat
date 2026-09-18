import { Pressable, ScrollView, Text, View } from "react-native";

import { EmptyState, ErrorState, LoadingScreen } from "@/components/screen-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, Divider } from "@/components/ui/card";
import { hitSize, radius, rtlText, spacing, type } from "@/constants/theme";
import { tapFeedback } from "@/lib/haptics";
import { useSetTeamMemberPermissions, useTeam } from "@/lib/queries";
import { useTheme } from "@/providers/theme-provider";
import type { TeamMember } from "@/types/api";

/**
 * Owner-granted extras, per employee — where روية الموظفة turns into a real
 * switch on the server. Role alone (مدير/موظفة) already decides most of what
 * she can touch; this is the handful of actions too destructive to hand out
 * by role, like deleting a message from a conversation. Matches the web
 * الموظفون page's toggles — same `restaurants.metadata.teamPermissions`
 * store, same permission keys.
 *
 * Deliberately narrower than the web team page: creating accounts and
 * resetting passwords stay a desktop task. This screen only grants.
 */

// Kept local rather than shared with `src/lib/permissions.ts` — the two apps
// don't share a package, and this is the one place on mobile that needs it.
const GRANTABLE_PERMISSIONS = { deleteMessages: "delete_messages" } as const;
const PERMISSION_LABEL: Record<string, string> = {
  [GRANTABLE_PERMISSIONS.deleteMessages]: "حذف الرسائل من المحادثات",
};
const ALL_PERMISSIONS = Object.values(GRANTABLE_PERMISSIONS);

const roleLabel = (role: string) => (role === "admin" ? "مدير" : "موظفة");

function PermissionChip({
  label,
  granted,
  disabled,
  onPress,
}: {
  label: string;
  granted: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: granted, disabled }}
      disabled={disabled}
      onPress={() => {
        tapFeedback();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: hitSize.min - 8,
        flexDirection: "row-reverse",
        alignItems: "center",
        paddingHorizontal: spacing.md,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: granted ? colors.brand : colors.border,
        backgroundColor: granted ? colors.brandSoft : colors.surface,
        opacity: disabled ? 0.6 : pressed ? 0.75 : 1,
      })}
    >
      <Text
        style={{
          ...type.footnote,
          fontWeight: granted ? "700" : "400",
          color: granted ? colors.onBrandSoft : colors.textSecondary,
          ...rtlText,
        }}
      >
        {granted ? "✓ " : ""}
        {label}
      </Text>
    </Pressable>
  );
}

function MemberRow({ member }: { member: TeamMember }) {
  const { colors } = useTheme();
  const setPermissions = useSetTeamMemberPermissions();
  const busy = setPermissions.isPending && setPermissions.variables?.id === member.id;

  const toggle = (key: string) => {
    const has = member.permissions.includes(key);
    const next = has
      ? member.permissions.filter((p) => p !== key)
      : [...member.permissions, key];
    setPermissions.mutate({ id: member.id, permissions: next });
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row-reverse", alignItems: "center", gap: spacing.sm }}>
        <Avatar name={member.fullName} seed={member.id} size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ ...type.calloutStrong, color: colors.text, ...rtlText }}>
            {member.fullName || member.email || "بدون اسم"}
          </Text>
          {member.email ? (
            <Text numberOfLines={1} style={{ ...type.footnote, color: colors.textTertiary }}>
              {member.email}
            </Text>
          ) : null}
        </View>
        <Badge
          label={roleLabel(member.role)}
          tone={member.role === "admin" ? "brand" : "neutral"}
        />
        {member.isActive === false ? <Badge label="موقوفة" tone="warning" /> : null}
      </View>

      {/* An admin's role already covers everything grantable here — the
          toggle only means something for an employee. */}
      {member.role !== "admin" ? (
        <View style={{ flexDirection: "row-reverse", flexWrap: "wrap", gap: spacing.sm }}>
          {ALL_PERMISSIONS.map((key) => (
            <PermissionChip
              key={key}
              label={PERMISSION_LABEL[key] ?? key}
              granted={member.permissions.includes(key)}
              disabled={busy}
              onPress={() => toggle(key)}
            />
          ))}
        </View>
      ) : null}

      {busy && setPermissions.isError ? (
        <Text style={{ ...type.footnote, color: colors.danger, ...rtlText }}>
          تعذّر تحديث الصلاحية. حاولي مرة أخرى.
        </Text>
      ) : null}
    </View>
  );
}

export default function TeamPermissionsScreen() {
  const { colors } = useTheme();
  const team = useTeam();

  if (team.isLoading) return <LoadingScreen label="جارٍ تحميل الفريق…" />;
  if (team.isError) {
    return (
      <ErrorState
        title="تعذّر تحميل الفريق"
        message={team.error?.message ?? "تعذّر تحميل الفريق"}
        onRetry={() => void team.refetch()}
      />
    );
  }

  const members = team.data?.team ?? [];
  if (members.length === 0) {
    return (
      <EmptyState
        icon="person.2"
        title="لا يوجد موظفون بعد"
        detail="أنشئي حسابات الموظفين من الكمبيوتر، ثم امنحيهن الصلاحيات من هنا."
      />
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing["4xl"] }}
    >
      <View
        style={{
          padding: spacing.md,
          borderRadius: radius.lg,
          backgroundColor: colors.surfaceSunken,
        }}
      >
        <Text style={{ ...type.caption, color: colors.textSecondary, ...rtlText }}>
          امنحي كل موظفة الصلاحيات الإضافية التي تثقين بها معها. إنشاء الحسابات وتغيير كلمات
          المرور ما زال من الكمبيوتر فقط.
        </Text>
      </View>

      <Card>
        {members.map((member, index) => (
          <View key={member.id}>
            {index > 0 ? <Divider /> : null}
            <View style={{ paddingVertical: index > 0 ? spacing.md : 0 }}>
              <MemberRow member={member} />
            </View>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}
