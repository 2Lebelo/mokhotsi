import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="sell" options={{ title: 'Sell' }} />
      <Tabs.Screen name="catalogue" options={{ title: 'Catalogue' }} />
      <Tabs.Screen name="sales" options={{ title: 'Sales' }} />
      <Tabs.Screen name="debug" options={{ title: 'Debug' }} />
    </Tabs>
  );
}
