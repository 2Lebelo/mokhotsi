import { Tabs } from "expo-router";
import { Text } from "react-native";
import { usePalette } from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";

export default function AppTabs() {
  const c = usePalette();
  const { store } = useShop();
  const count = store.cart().reduce((sum, item) => sum + item.quantity, 0);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
        tabBarLabelStyle: { fontWeight: "600", fontSize: 11 },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 25 }}>⌂</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="catalogue"
        options={{
          title: "Catalogue",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 24 }}>▦</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: "Cart",
          tabBarBadge: count ? (count > 99 ? "99+" : count) : undefined,
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 25 }}>＋</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="sales"
        options={{
          title: "Sales",
          tabBarIcon: ({ color }) => (
            <Text style={{ color, fontSize: 26 }}>≡</Text>
          ),
        }}
      />
    </Tabs>
  );
}
