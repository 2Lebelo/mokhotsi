import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router/js-tabs";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

import { usePalette } from "@/components/shop-ui";
import { TillTabButton } from "@/components/till-tab-button";
import { useShop } from "@/db/ShopProvider";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

function icon(name: IconName) {
  function TabIcon({ color }: { color: ColorValue }) {
    return <MaterialCommunityIcons name={name} size={24} color={color} />;
  }
  return TabIcon;
}

export default function AppTabs() {
  const c = usePalette();
  const { store } = useShop();
  const count = store.cart.count();
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
          tabBarIcon: icon("view-dashboard-outline"),
        }}
      />
      <Tabs.Screen
        name="catalogue"
        options={{ title: "Catalogue", tabBarIcon: icon("view-grid-outline") }}
      />
      <Tabs.Screen
        name="till"
        options={{
          title: "Till",
          tabBarButton: (props) => <TillTabButton {...props} />,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: "Cart",
          tabBarBadge: count ? (count > 99 ? "99+" : count) : undefined,
          tabBarIcon: icon("cart-outline"),
        }}
      />
      <Tabs.Screen
        name="sales"
        options={{ title: "Sales", tabBarIcon: icon("receipt-text-outline") }}
      />
    </Tabs>
  );
}
