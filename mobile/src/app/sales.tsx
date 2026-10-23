import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import {
  Button,
  Card,
  Divider,
  Empty,
  font,
  Screen,
  TopBar,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import type { Sale } from "@/db/store";
import { sameLocalDay } from "@/domain/periods";
import { ReverseSaleSheet } from "@/features/sales/reverse-sale-sheet";
import { formatMoney } from "@/lib/money";

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

export default function SalesScreen() {
  const { store } = useShop();
  const c = usePalette();
  const [limit, setLimit] = useState(50);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reversing, setReversing] = useState<Sale | null>(null);
  const page = store.sales.list(limit + 1);
  const sales = page.slice(0, limit);
  const now = new Date();
  return (
    <Screen scroll={false}>
      <TopBar
        title="Sales history"
        subtitle="Completed sales on this device. Tap one for its receipt."
        onBack={leave}
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
          const fully =
            sale.reversed_count > 0 && sale.reversed_count >= sale.item_count;
          const status = fully
            ? "Reversed"
            : sale.reversed_count > 0
              ? "Partly reversed"
              : null;
          const canReverse =
            sale.reversed_count < sale.item_count &&
            sameLocalDay(new Date(sale.created_at), now);
          return (
            <Card style={{ paddingVertical: 14 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`Sale ${sale.id.slice(0, 8)}, ${formatMoney(sale.total_cents)}${status ? `, ${status}` : ""}. ${open ? "Hide" : "View"} receipt.`}
                onPress={() => setExpanded(open ? null : sale.id)}
                style={({ pressed }) => [
                  ui.row,
                  { minHeight: 44, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <View style={ui.grow}>
                  <View style={[ui.row, { gap: 8 }]}>
                    <Text
                      style={[ui.sectionTitle, { color: c.text, fontSize: 15 }]}
                    >
                      #{sale.id.slice(0, 8).toUpperCase()}
                    </Text>
                    {status && (
                      <View
                        style={[styles.pill, { backgroundColor: c.dangerTint }]}
                      >
                        <Text style={[styles.pillText, { color: c.danger }]}>
                          {status}
                        </Text>
                      </View>
                    )}
                  </View>
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
                <View style={{ alignItems: "flex-end" }}>
                  <Text
                    style={[
                      ui.money,
                      {
                        color: fully ? c.faint : c.text,
                        fontSize: 15,
                        textDecorationLine: fully ? "line-through" : "none",
                      },
                    ]}
                  >
                    {formatMoney(sale.total_cents)}
                  </Text>
                  {sale.refunded_cents > 0 && !fully && (
                    <Text style={[ui.caption, { color: c.danger }]}>
                      −{formatMoney(sale.refunded_cents)}
                    </Text>
                  )}
                </View>
                <Ionicons
                  name={open ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={c.faint}
                />
              </Pressable>
              {open && (
                <Receipt
                  sale={sale}
                  canReverse={canReverse}
                  onReverse={() => setReversing(sale)}
                />
              )}
            </Card>
          );
        }}
      />
      {reversing && (
        <ReverseSaleSheet
          key={reversing.id}
          sale={reversing}
          items={store.sales.items(reversing.id)}
          onClose={() => setReversing(null)}
        />
      )}
    </Screen>
  );
}

function Receipt({
  sale,
  canReverse,
  onReverse,
}: {
  sale: Sale;
  canReverse: boolean;
  onReverse: () => void;
}) {
  const { store } = useShop();
  const c = usePalette();
  const reversals = store.sales.reversals(sale.id);
  return (
    <View style={ui.stack}>
      <Divider />
      {store.sales.items(sale.id).map((item) => (
        <View key={item.id} style={ui.spread}>
          <View style={ui.grow}>
            <Text style={[ui.body, { color: c.text, fontSize: 14 }]}>
              {item.product_name} · {item.variant_label}
            </Text>
            <Text style={[ui.caption, { color: c.muted }]}>
              {item.quantity} × {formatMoney(item.unit_price_cents)}
              {item.reversed_quantity > 0 && (
                <Text style={{ color: c.danger }}>
                  {" "}
                  · {item.reversed_quantity} returned
                </Text>
              )}
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
      {reversals.map((reversal) => (
        <ReceiptLine
          key={reversal.id}
          label={`Refunded · ${reversal.reason} · ${new Date(
            reversal.created_at,
          ).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })}`}
          cents={-reversal.refund_cents}
          danger
        />
      ))}
      {canReverse && (
        <Button
          title="Reverse sale"
          icon="return-down-back"
          variant="danger"
          size="sm"
          onPress={onReverse}
        />
      )}
    </View>
  );
}

function ReceiptLine({
  label,
  cents,
  strong = false,
  danger = false,
}: {
  label: string;
  cents: number;
  strong?: boolean;
  danger?: boolean;
}) {
  const c = usePalette();
  return (
    <View style={ui.spread}>
      <Text
        style={[
          strong ? ui.sectionTitle : ui.body,
          ui.grow,
          {
            color: danger ? c.danger : strong ? c.text : c.muted,
            fontSize: 14,
          },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          ui.money,
          { color: danger ? c.danger : c.text, fontSize: strong ? 16 : 14 },
        ]}
      >
        {cents < 0 ? `−${formatMoney(-cents)}` : formatMoney(cents)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { ...font.semibold, fontSize: 11 },
});
