import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import type { UserOut } from "@/api/types";
import { font, ui, usePalette } from "@/components/shop-ui";

const STATUS = {
  pending: "Waiting",
  active: "Approved",
  rejected: "Rejected",
  disabled: "Disabled",
} as const;

export function registeredOn(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function OwnerRow({ owner, onPress }: { owner: UserOut; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${owner.name}, ${owner.phone ?? ""}, ${STATUS[owner.status]}`}
      onPress={onPress}
      style={({ pressed }) => [ui.row, { minHeight: 56, opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={ui.grow}>
        <Text style={[ui.body, font.medium, { color: c.text }]}>{owner.name}</Text>
        <Text style={[ui.caption, { color: c.muted }]}>
          {owner.phone} · since {registeredOn(owner.created_at)}
        </Text>
      </View>
      <Text
        style={[
          ui.caption,
          font.semibold,
          { color: owner.status === "active" ? c.accent : owner.status === "pending" ? c.muted : c.danger },
        ]}
      >
        {STATUS[owner.status]}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={c.faint} />
    </Pressable>
  );
}
