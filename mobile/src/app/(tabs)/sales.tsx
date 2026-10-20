import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

import {
  Button,
  Card,
  Divider,
  Empty,
  Heading,
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
  const page = store.sales.list(limit + 1);
  const sales = page.slice(0, limit);
  return (
    <Screen scroll={false}>
      <Heading
        title="Sales"
        subtitle="Completed sales on this device. Tap one for its receipt."
      />
      <FlatList
        data={sales}
        keyExtractor={(sale) => sale.id}
        contentContainerStyle={{ gap: 10, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Empty
            icon="receipt-outline"
            title="No sales yet"
            description="Take payment from the cart to see its receipt here."
          />
        }
        ListFooterComponent={
          page.length > limit ? (
            <Button
              title="Load more sales"
              variant="ghost"
              onPress={() => setLimit((value) => value + 50)}
            />
          ) : null
        }
        renderItem={({ item: sale }) => {
          const open = expanded === sale.id;
          return (
            <Card style={{ paddingVertical: 14 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`Sale ${sale.id.slice(0, 8)}, ${formatMoney(sale.total_cents)}. ${open ? "Hide" : "View"} receipt.`}
                onPress={() => setExpanded(open ? null : sale.id)}
                style={({ pressed }) => [
                  ui.row,
                  { minHeight: 44, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <View style={ui.grow}>
                  <Text
                    style={[ui.sectionTitle, { color: c.text, fontSize: 15 }]}
                  >
                    #{sale.id.slice(0, 8).toUpperCase()}
                  </Text>
                  <Text style={[ui.caption, { color: c.muted }]}>
                    {new Date(sale.created_at).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {sale.item_count}{" "}
                    {sale.item_count === 1 ? "item" : "items"}
                  </Text>
                </View>
                <Text style={[ui.money, { color: c.text, fontSize: 15 }]}>
                  {formatMoney(sale.total_cents)}
                </Text>
                <Ionicons
                  name={open ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={c.faint}
                />
              </Pressable>
              {open && (
                <View style={ui.stack}>
                  <Divider />
                  {store.sales.items(sale.id).map((item) => (
                    <View key={item.id} style={ui.spread}>
                      <View style={ui.grow}>
                        <Text
                          style={[ui.body, { color: c.text, fontSize: 14 }]}
                        >
                          {item.product_name} · {item.variant_label}
                        </Text>
                        <Text style={[ui.caption, { color: c.muted }]}>
                          {item.quantity} × {formatMoney(item.unit_price_cents)}
                        </Text>
                      </View>
                      <Text style={[ui.money, { color: c.text, fontSize: 14 }]}>
                        {formatMoney(item.line_total_cents)}
                      </Text>
                    </View>
                  ))}
                  <Divider />
                  <ReceiptLine label="Total" cents={sale.total_cents} strong />
                  {sale.tendered_cents !== null && (
                    <ReceiptLine label="Cash" cents={sale.tendered_cents} />
                  )}
                  {sale.change_cents !== null && (
                    <ReceiptLine label="Change" cents={sale.change_cents} />
                  )}
                </View>
              )}
            </Card>
          );
        }}
      />
    </Screen>
  );
}

function ReceiptLine({
  label,
  cents,
  strong = false,
}: {
  label: string;
  cents: number;
  strong?: boolean;
}) {
  const c = usePalette();
  return (
    <View style={ui.spread}>
      <Text
        style={[
          strong ? ui.sectionTitle : ui.body,
          { color: strong ? c.text : c.muted, fontSize: 14 },
        ]}
      >
        {label}
      </Text>
      <Text style={[ui.money, { color: c.text, fontSize: strong ? 16 : 14 }]}>
        {formatMoney(cents)}
      </Text>
    </View>
  );
}
