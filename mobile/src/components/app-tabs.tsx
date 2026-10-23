import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router/js-tabs";
import type { ColorValue } from "react-native";

import { MenuTabButton } from "@/components/dock-menu";
import { font, usePalette, type IconName } from "@/components/shop-ui";
import { TillTabButton } from "@/components/till-tab-button";
import { useShop } from "@/db/ShopProvider";

/** Outline icon when idle, filled when the tab is selected. */
function icon(outline: IconName, filled: IconName) {
  function TabIcon({
    color,
    focused,
  }: {
    color: ColorValue;
    focused: boolean;
  }) {
    return (
      <Ionicons name={focused ? filled : outline} size={22} color={color} />
    );
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
        tabBarInactiveTintColor: c.faint,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          elevation: 0,
        },
        tabBarLabelStyle: { ...font.medium, fontSize: 11 },
        tabBarBadgeStyle: {
          ...font.semibold,
          backgroundColor: c.accent,
          color: c.onAccent,
          fontSize: 10,
        },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: icon("home-outline", "home"),
        }}
      />
      <Tabs.Screen
        name="catalogue"
        options={{
          title: "Catalogue",
          tabBarIcon: icon("book-outline", "book"),
        }}
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
          tabBarIcon: icon("cart-outline", "cart"),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: "Menu",
          tabBarButton: (props) => <MenuTabButton {...props} />,
        }}
      />
    </Tabs>
  );
}
