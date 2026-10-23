import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import type { BottomTabBarButtonProps } from "expo-router/js-tabs";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Divider,
  font,
  ui,
  usePalette,
  type IconName,
} from "@/components/shop-ui";

type DockItem = {
  label: string;
  description: string;
  icon: IconName;
  /** Omitted for entries that are not available yet. */
  href?: Href;
};

/** Everything that is not used at the till every minute. Add new entries here. */
const ITEMS: readonly DockItem[] = [
  {
    label: "Sales history",
    description: "Receipts, refunds and reversals",
    icon: "receipt-outline",
    href: "/sales",
  },
  {
    label: "Reports",
    description: "Takings, profit and best sellers",
    icon: "stats-chart-outline",
    href: "/reports",
  },
  {
    label: "Users",
    description: "Coming soon",
    icon: "people-outline",
  },
];

/**
 * The ☰ Menu slot in the tab bar. It looks like a tab but never navigates:
 * it opens the dock menu over the current screen.
 */
export function MenuTabButton({ testID }: BottomTabBarButtonProps) {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Menu"
        accessibilityHint="Opens sales history, reports and users"
        accessibilityState={{ expanded: open }}
        testID={testID}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons
          name={open ? "menu" : "menu-outline"}
          size={22}
          color={open ? c.accent : c.faint}
        />
        <Text style={[styles.tabLabel, { color: open ? c.accent : c.faint }]}>
          Menu
        </Text>
      </Pressable>
      <DockMenu visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function DockMenu({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        accessibilityRole="button"
        accessibilityLabel="Close menu"
        onPress={onClose}
      />
      <View
        style={[
          styles.card,
          {
            bottom: insets.bottom + 72,
            backgroundColor: c.surface,
            borderColor: c.border,
          },
        ]}
      >
        <Text
          accessibilityRole="header"
          style={[ui.sectionTitle, styles.title, { color: c.text }]}
        >
          Menu
        </Text>
        {ITEMS.map((item) => {
          const available = !!item.href;
          return (
            <View key={item.label}>
              <Divider />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.label}. ${item.description}`}
                accessibilityState={{ disabled: !available }}
                disabled={!available}
                onPress={() => {
                  onClose();
                  if (item.href) router.push(item.href);
                }}
                style={({ pressed }) => [
                  ui.row,
                  styles.item,
                  { opacity: !available ? 0.5 : pressed ? 0.6 : 1 },
                ]}
              >
                <View style={[styles.icon, { backgroundColor: c.subtle }]}>
                  <Ionicons name={item.icon} size={18} color={c.text} />
                </View>
                <View style={ui.grow}>
                  <Text style={[ui.body, font.medium, { color: c.text }]}>
                    {item.label}
                  </Text>
                  <Text style={[ui.caption, { color: c.muted }]}>
                    {item.description}
                  </Text>
                </View>
                {available && (
                  <Ionicons name="chevron-forward" size={18} color={c.faint} />
                )}
              </Pressable>
            </View>
          );
        })}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingTop: 6,
  },
  tabLabel: { ...font.medium, fontSize: 11 },
  backdrop: { backgroundColor: "rgba(15,20,25,0.25)" },
  card: {
    position: "absolute",
    left: 16,
    right: 16,
    maxWidth: 520,
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
    elevation: 8,
    shadowColor: "#0F1419",
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
  title: { paddingBottom: 10 },
  item: { minHeight: 60, paddingVertical: 10 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
