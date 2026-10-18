import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import {
  Button,
  Card,
  Empty,
  Heading,
  Label,
  Screen,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import { formatMoney } from "@/lib/money";

export default function DashboardScreen() {
  const { store } = useShop();
  const c = usePalette();
  const stats = store.dashboard();
  const recent = store.sales(3);
  return (
    <Screen>
      <Heading
        title="Your shop, at a glance"
        subtitle={new Date().toLocaleDateString("en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      />
      <View style={[styles.hero, { backgroundColor: c.accent }]}>
        <Text style={[styles.heroLabel, { color: c.background }]}>
          TODAY’S SALES
        </Text>
        <Text style={[styles.amount, { color: c.background }]}>
          {formatMoney(stats.today_total)}
        </Text>
        <Text style={[ui.body, { color: c.background }]}>
          {stats.today_sales} completed{" "}
          {stats.today_sales === 1 ? "sale" : "sales"} · LSL
        </Text>
      </View>
      <View style={ui.wrap}>
        {[
          ["Products", stats.product_count],
          ["Units in stock", stats.unit_count],
          ["Out of stock", stats.out_of_stock],
        ].map(([label, value]) => (
          <View
            key={label}
            style={[
              styles.metric,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <Text style={[styles.metricNumber, { color: c.text }]}>
              {value}
            </Text>
            <Label muted>{label}</Label>
          </View>
        ))}
      </View>
      <View style={ui.row}>
        <View style={ui.grow}>
          <Button
            title="Start a sale"
            onPress={() => router.navigate("/catalogue")}
          />
        </View>
        <View style={ui.grow}>
          <Button
            title="Add product"
            secondary
            onPress={() => router.push("/register")}
          />
        </View>
      </View>
      <View style={ui.spread}>
        <Text style={[ui.sectionTitle, { color: c.text }]}>Recent sales</Text>
        <Button
          title="View all"
          secondary
          onPress={() => router.navigate("/sales")}
        />
      </View>
      {recent.length ? (
        recent.map((sale) => (
          <Card key={sale.id}>
            <View style={ui.spread}>
              <View style={ui.grow}>
                <Label>Sale #{sale.id.slice(0, 8).toUpperCase()}</Label>
                <Label muted>
                  {new Date(sale.created_at).toLocaleString("en-GB")}
                </Label>
              </View>
              <Text style={[ui.sectionTitle, { color: c.text }]}>
                {formatMoney(sale.total_cents)}
              </Text>
            </View>
          </Card>
        ))
      ) : (
        <Empty
          title="Ready for your first sale"
          description="Register your products, add them to the cart, and complete a sale. Your totals will appear here."
        />
      )}
      <Card>
        <Text style={[ui.sectionTitle, { color: c.text }]}>
          Ready without internet
        </Text>
        <Label muted>
          Products, photos, your cart, and completed sales are saved on this
          device.
        </Label>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 24, borderRadius: 24, gap: 10 },
  heroLabel: { fontSize: 12, fontWeight: "700", letterSpacing: 1.3 },
  amount: { fontSize: 38, fontWeight: "800", letterSpacing: -1 },
  metric: {
    flexGrow: 1,
    flexBasis: 90,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    gap: 5,
  },
  metricNumber: { fontSize: 26, fontWeight: "800" },
});
