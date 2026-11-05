import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import type { BottomTabBarButtonProps } from "expo-router/js-tabs";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";

import { useSession } from "@/auth/session-provider";
import { useShop } from "@/db/ShopProvider";
import { SignOutPhoneSheet } from "@/features/account/sign-out-phone-sheet";
import { syncStatusText } from "@/features/sync/sync-text";
import { useSync } from "@/features/sync/sync-provider";
import {
  Divider,
  font,
  IconButton,
  ui,
  usePalette,
  type IconName,
} from "@/components/shop-ui";

type DockItem = {
  label: string;
  description: string;
  icon: IconName;
  href?: Href;
  onPress?: () => void;
};

/**
 * Everything that is not used at the till every minute, filtered by what the person at the
 * till may do. Signing in happens before the till, never from here. Add new entries here.
 */
function useItems(onSignOutPhone: () => void): DockItem[] {
  const { can, lock, till } = useSession();
  const sync = useSync();
  const { store } = useShop();
  // Counts are read live, so dismissing an issue or queueing a sale shows at once.
  const run = till.kind === "open" ? sync.status(till.shop.id) : null;
  const status = run && { ...run, pending: store.outbox.pendingCount() };
  const items: (DockItem | false)[] = [
    can("sales:read") && {
      label: "Sales history",
      description: "Receipts, refunds and reversals",
      icon: "receipt-outline",
      href: "/sales",
    },
    can("reports:read") && {
      label: "Reports",
      description: "Takings, profit and best sellers",
      icon: "stats-chart-outline",
      href: "/reports",
    },
    can("members:manage") && {
      label: "Users",
      description: "Cashiers, their PINs and this shop's phones",
      icon: "people-outline",
      href: "/users",
    },
    can("shop:manage") && {
      label: "Shops",
      description: "Open another shop or add one to this phone",
      icon: "storefront-outline",
      href: "/shops",
    },
    {
      label: "Sync now",
      description: syncStatusText(status),
      icon: "sync-outline",
      onPress: sync.syncNow,
    },
    {
      label: "Change PIN",
      description: "Your PIN, in all your shops",
      icon: "keypad-outline",
      href: "/pin",
    },
    {
      label: "Lock",
      description: "Hand the phone to someone else",
      icon: "lock-closed-outline",
      onPress: lock,
    },
    can("devices:manage") && {
      label: "Sign this phone out",
      description: "Remove it from your shops and return to sign-in",
      icon: "log-out-outline",
      onPress: onSignOutPhone,
    },
  ];
  return items.filter((item): item is DockItem => item !== false);
}

/**
 * The ☰ Menu slot in the tab bar. It looks like a tab but never navigates:
 * it opens the dock menu over the current screen.
 */
export function MenuTabButton({ testID }: BottomTabBarButtonProps) {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Menu"
        accessibilityHint="Opens sales history, reports, users, shops and lock"
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
      <DockMenu
        visible={open}
        onClose={() => setOpen(false)}
        onSignOutPhone={() => setSigningOut(true)}
      />
      <SignOutPhoneSheet visible={signingOut} onClose={() => setSigningOut(false)} />
    </>
  );
}

export function DockMenu({
  visible,
  onClose,
  onSignOutPhone,
}: {
  visible: boolean;
  onClose: () => void;
  onSignOutPhone: () => void;
}) {
  const c = usePalette();
  const items = useItems(onSignOutPhone);
  const { till } = useSession();
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
      {/* Centred on the screen; taps around the card fall through to the backdrop. */}
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View
          entering={ZoomIn.duration(180)}
          style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
        >
          <View style={[ui.spread, styles.header]}>
            <View style={ui.grow}>
              <Text accessibilityRole="header" style={[ui.sectionTitle, { color: c.text }]}>
                Menu
              </Text>
              {till.kind === "open" && (
                <Text numberOfLines={1} style={[ui.caption, { color: c.muted }]}>
                  {till.member.name} · {till.shop.name}
                </Text>
              )}
            </View>
            <IconButton icon="close" size={34} accessibilityLabel="Close menu" onPress={onClose} />
          </View>
          {items.map((item) => (
            <View key={item.label}>
              <Divider />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.label}. ${item.description}`}
                onPress={() => {
                  onClose();
                  if (item.href) router.push(item.href);
                  item.onPress?.();
                }}
                style={({ pressed }) => [ui.row, styles.item, { opacity: pressed ? 0.6 : 1 }]}
              >
                <View style={[styles.icon, { backgroundColor: c.subtle }]}>
                  <Ionicons name={item.icon} size={18} color={c.text} />
                </View>
                <View style={ui.grow}>
                  <Text style={[ui.body, font.medium, { color: c.text }]}>{item.label}</Text>
                  <Text style={[ui.caption, { color: c.muted }]}>{item.description}</Text>
                </View>
                {item.href && <Ionicons name="chevron-forward" size={18} color={c.faint} />}
              </Pressable>
            </View>
          ))}
        </Animated.View>
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
  center: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
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
  header: { paddingBottom: 10 },
  item: { minHeight: 60, paddingVertical: 10 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
