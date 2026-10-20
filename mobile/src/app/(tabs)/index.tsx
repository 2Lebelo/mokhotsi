import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  Button,
  Card,
  Divider,
  Empty,
  font,
  Heading,
  Screen,
  SectionHeader,
  ui,
  usePalette,
  type IconName,
} from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import { formatMoney } from "@/lib/money";

export default function DashboardScreen() {
  const { store } = useShop();
  const c = usePalette();
  const stats = store.sales.dashboard();
  const recent = store.sales.list(5);
  const metrics: {
    label: string;
    value: number;
    icon: IconName;
    alert?: boolean;
  }[] = [
    { label: "Products", value: stats.product_count, icon: "book-outline" },
    { label: "Units in stock", value: stats.unit_count, icon: "cube-outline" },
    {
      label: "Out of stock",
      value: stats.out_of_stock,
      icon: "alert-circle-outline",
      alert: stats.out_of_stock > 0,
    },
  ];
  return (
    <Screen>
      <Heading
        title="Today"
        subtitle={new Date().toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      />

      <Card style={{ gap: 6, padding: 20 }}>
        <Text style={[ui.caption, font.medium, { color: c.muted }]}>
          Today’s sales · LSL
        </Text>
        <Text style={[ui.money, styles.amount, { color: c.text }]}>
          {formatMoney(stats.today_total)}
        </Text>
        <Text style={[ui.caption, { color: c.muted }]}>
          {stats.today_sales} completed{" "}
          {stats.today_sales === 1 ? "sale" : "sales"}
        </Text>
        <View style={[ui.row, { marginTop: 12 }]}>
          <View style={ui.grow}>
            <Button
              title="Start a sale"
              icon="scan-outline"
              onPress={() => router.navigate("/till")}
            />
          </View>
          <View style={ui.grow}>
            <Button
              title="Add product"
              icon="add"
              secondary
              onPress={() => router.push("/register")}
            />
          </View>
        </View>
      </Card>

      <View style={ui.row}>
        {metrics.map(({ label, value, icon, alert }) => (
          <View
            key={label}
            style={[styles.metric, { backgroundColor: c.subtle }]}
          >
            <Ionicons
              name={icon}
              size={18}
              color={alert ? c.danger : c.muted}
            />
            <Text
              style={[
                ui.money,
                styles.metricNumber,
                { color: alert ? c.danger : c.text },
              ]}
            >
              {value}
            </Text>
            <Text numberOfLines={1} style={[ui.caption, { color: c.muted }]}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      <SectionHeader
        title="Recent sales"
        action={
          recent.length ? (
            <Button
              title="View all"
              variant="ghost"
              size="sm"
              onPress={() => router.navigate("/sales")}
            />
          ) : undefined
        }
      />
      {recent.length ? (
        <Card style={{ paddingVertical: 4, gap: 0 }}>
          {recent.map((sale, i) => (
            <View key={sale.id}>
              {i > 0 && <Divider />}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Sale ${sale.id.slice(0, 8)}, ${formatMoney(sale.total_cents)}. Open sales`}
                onPress={() => router.navigate("/sales")}
                style={({ pressed }) => [
                  ui.row,
                  styles.saleRow,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <View style={[styles.saleIcon, { backgroundColor: c.subtle }]}>
                  <Ionicons name="receipt-outline" size={18} color={c.muted} />
                </View>
                <View style={ui.grow}>
                  <Text style={[ui.body, font.medium, { color: c.text }]}>
                    #{sale.id.slice(0, 8).toUpperCase()}
                  </Text>
                  <Text style={[ui.caption, { color: c.muted }]}>
                    {new Date(sale.created_at).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {sale.item_count}{" "}
                    {sale.item_count === 1 ? "item" : "items"}
                    {sale.change_cents
                      ? ` · change ${formatMoney(sale.change_cents)}`
                      : ""}
                  </Text>
                </View>
                <Text style={[ui.money, { color: c.text, fontSize: 15 }]}>
                  {formatMoney(sale.total_cents)}
                </Text>
              </Pressable>
            </View>
          ))}
        </Card>
      ) : (
        <Empty
          icon="sparkles-outline"
          title="Ready for your first sale"
          description="Register your products, scan them at the till, and take payment. Your totals will appear here."
        />
      )}

      <View style={[ui.row, { gap: 8, justifyContent: "center" }]}>
        <Ionicons name="cloud-offline-outline" size={14} color={c.faint} />
        <Text style={[ui.caption, { color: c.faint }]}>
          Works without internet · saved on this device
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  amount: { fontSize: 34, lineHeight: 42, letterSpacing: -0.8 },
  metric: {
    flex: 1,
    padding: 14,
    borderRadius: 14,
    gap: 4,
  },
  metricNumber: { fontSize: 20, marginTop: 4 },
  saleRow: { paddingVertical: 12 },
  saleIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
