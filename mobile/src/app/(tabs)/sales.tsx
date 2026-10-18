import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

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

export default function SalesScreen() {
  const { store } = useShop();
  const c = usePalette();
  const [limit, setLimit] = useState(50);
  const [expanded, setExpanded] = useState<string | null>(null);
  const page = store.sales(limit + 1);
  const sales = page.slice(0, limit);
  return (
    <Screen scroll={false}>
      <Heading
        title="Sales history"
        subtitle="Completed sales, saved on this device. Tap a sale for its receipt."
      />
      <FlatList
        data={sales}
        keyExtractor={(sale) => sale.id}
        contentContainerStyle={{ gap: 14, paddingBottom: 20 }}
        ListEmptyComponent={
          <Empty
            title="No sales yet"
            description="Complete a sale from the cart to see its receipt here."
          />
        }
        ListFooterComponent={
          page.length > limit ? (
            <Button
              title="Load more sales"
              secondary
              onPress={() => setLimit((value) => value + 50)}
            />
          ) : null
        }
        renderItem={({ item: sale }) => (
          <Card>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: expanded === sale.id }}
              accessibilityLabel={`Sale ${sale.id.slice(0, 8)}, ${formatMoney(sale.total_cents)}. View receipt.`}
              onPress={() => setExpanded(expanded === sale.id ? null : sale.id)}
              style={{ minHeight: 64, gap: 8 }}
            >
              <View style={ui.spread}>
                <Text style={[ui.sectionTitle, { color: c.text }]}>
                  #{sale.id.slice(0, 8).toUpperCase()}
                </Text>
                <Text style={[ui.sectionTitle, { color: c.accent }]}>
                  {formatMoney(sale.total_cents)}
                </Text>
              </View>
              <Label muted>
                {new Date(sale.created_at).toLocaleString("en-GB")} ·{" "}
                {sale.item_count} {sale.item_count === 1 ? "item" : "items"}
              </Label>
              <Text style={[ui.caption, { color: c.accent }]}>
                {expanded === sale.id ? "Hide receipt −" : "View receipt +"}
              </Text>
            </Pressable>
            {expanded === sale.id && (
              <View style={ui.stack}>
                <View style={[ui.divider, { backgroundColor: c.border }]} />
                {store.saleItems(sale.id).map((item) => (
                  <View key={item.id} style={ui.spread}>
                    <View style={ui.grow}>
                      <Label>{item.product_name}</Label>
                      <Label muted>
                        {item.quantity} × {formatMoney(item.unit_price_cents)} ·{" "}
                        {item.category}
                      </Label>
                    </View>
                    <Label>{formatMoney(item.line_total_cents)}</Label>
                  </View>
                ))}
                <View style={[ui.divider, { backgroundColor: c.border }]} />
                <View style={ui.spread}>
                  <Label>Total · LSL</Label>
                  <Text style={[ui.sectionTitle, { color: c.text }]}>
                    {formatMoney(sale.total_cents)}
                  </Text>
                </View>
              </View>
            )}
          </Card>
        )}
      />
    </Screen>
  );
}
