import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";

import {
  Button,
  Card,
  Divider,
  Empty,
  errorMessage,
  Heading,
  Notice,
  Screen,
  Stepper,
  Thumb,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useToast } from "@/components/toast";
import { useShop } from "@/db/ShopProvider";
import { cartTotal } from "@/db/store";
import { variantLabel } from "@/domain/units";
import { CashCheckoutSheet } from "@/features/checkout/cash-checkout-sheet";
import { afterPaint } from "@/lib/after-paint";
import { formatMoney } from "@/lib/money";

type Receipt = { id: string; total: number; tendered: number; change: number };

export default function CartScreen() {
  const { store, refresh } = useShop();
  const toast = useToast();
  const c = usePalette();
  const items = store.cart.items();
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  /** The sale reference for the open payment; reused if Complete is pressed twice. */
  const [paying, setPaying] = useState<string | null>(null);
  const [payError, setPayError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  let total = 0;
  let totalError = "";
  try {
    total = cartTotal(items);
  } catch (cause) {
    totalError = errorMessage(cause);
  }
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const exceedsStock = items.some((item) => item.quantity > item.stock);

  function changeQuantity(id: string, quantity: number, name: string) {
    try {
      store.cart.setQuantity(id, quantity);
      setError("");
      setReceipt(null);
      refresh();
      if (quantity === 0) toast.info(`${name} removed`);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function openPayment() {
    setPayError("");
    setPaying(randomUUID());
  }

  function complete(tendered: number) {
    if (submitting.current || !paying) return;
    submitting.current = true;
    const saleId = paying;
    setBusy(true);
    setPayError("");
    afterPaint(() => {
      try {
        store.sales.checkout(saleId, tendered);
        const sale = { id: saleId, total, tendered, change: tendered - total };
        setReceipt(sale);
        setPaying(null);
        setError("");
        refresh();
        toast.success(
          sale.change > 0
            ? `Sale complete · Change ${formatMoney(sale.change)}`
            : "Sale complete",
        );
      } catch (cause) {
        setPayError(errorMessage(cause));
      } finally {
        submitting.current = false;
        setBusy(false);
      }
    });
  }

  function clear() {
    Alert.alert("Clear cart?", "Remove all products from this cart?", [
      { text: "Keep cart", style: "cancel" },
      {
        text: "Clear cart",
        style: "destructive",
        onPress: () => {
          try {
            store.cart.clear();
            setError("");
            refresh();
            toast.info("Cart cleared");
          } catch (cause) {
            setError(errorMessage(cause));
          }
        },
      },
    ]);
  }

  return (
    <Screen scroll={false}>
      <Heading
        title="Cart"
        subtitle={
          count
            ? `${count} ${count === 1 ? "item" : "items"} · prices in LSL`
            : "Review quantities and take payment."
        }
        action={
          items.length > 0 ? (
            <Button
              title="Clear"
              variant="ghost"
              size="sm"
              disabled={busy}
              onPress={clear}
            />
          ) : undefined
        }
      />
      {!!(error || totalError) && (
        <Notice message={error || totalError} error />
      )}
      {exceedsStock && (
        <Notice
          message="Some quantities exceed available stock. Reduce them or update the product’s stock before taking payment."
          error
        />
      )}
      {receipt && items.length === 0 && <ReceiptCard receipt={receipt} />}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 10, paddingBottom: 12 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          receipt ? null : (
            <Empty
              icon="cart-outline"
              title="Your cart is empty"
              description="Scan products at the till, or add them from the catalogue."
              action={
                <Button
                  title="Open the till"
                  icon="scan-outline"
                  onPress={() => router.navigate("/till")}
                />
              }
            />
          )
        }
        renderItem={({ item }) => {
          const name = `${item.product_name} · ${variantLabel(item)}`;
          const over = item.quantity > item.stock;
          return (
            <Card style={{ gap: 10 }}>
              <View style={ui.row}>
                <Thumb
                  uri={item.photo_uri}
                  name={item.product_name}
                  size={44}
                />
                <View style={ui.grow}>
                  <Text
                    numberOfLines={1}
                    style={[ui.sectionTitle, { color: c.text, fontSize: 15 }]}
                  >
                    {item.product_name}
                  </Text>
                  <Text style={[ui.caption, { color: c.muted }]}>
                    {variantLabel(item)} · {formatMoney(item.price_cents)} each
                  </Text>
                </View>
                <Text style={[ui.money, { color: c.text, fontSize: 15 }]}>
                  {formatMoney(item.price_cents * item.quantity)}
                </Text>
              </View>
              <View style={ui.spread}>
                <Text
                  style={[ui.caption, { color: over ? c.danger : c.muted }]}
                >
                  {item.stock} available
                </Text>
                <Stepper
                  value={item.quantity}
                  name={name}
                  max={item.stock}
                  disabled={busy}
                  onChange={(quantity) =>
                    changeQuantity(item.id, quantity, name)
                  }
                />
              </View>
            </Card>
          );
        }}
      />
      {items.length > 0 && (
        <View style={[styles.footer, { borderColor: c.border }]}>
          <View style={ui.spread}>
            <Text style={[ui.body, { color: c.muted }]}>Total</Text>
            <Text style={[ui.money, styles.total, { color: c.text }]}>
              {totalError ? "—" : formatMoney(total)}
            </Text>
          </View>
          <Button
            title={totalError ? "Take payment" : `Charge ${formatMoney(total)}`}
            icon="cash-outline"
            disabled={exceedsStock || !!totalError || busy}
            onPress={openPayment}
          />
        </View>
      )}
      <CashCheckoutSheet
        key={paying ?? "closed"}
        visible={paying !== null}
        totalCents={total}
        itemCount={count}
        busy={busy}
        error={payError}
        onComplete={complete}
        onClose={() => setPaying(null)}
      />
    </Screen>
  );
}

function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const c = usePalette();
  const rows: [string, number][] = [
    ["Total", receipt.total],
    ["Cash received", receipt.tendered],
  ];
  return (
    <Card style={{ gap: 14 }}>
      <View style={ui.row}>
        <View style={[styles.check, { backgroundColor: c.tint }]}>
          <Ionicons name="checkmark" size={22} color={c.accent} />
        </View>
        <View style={ui.grow}>
          <Text style={[ui.sectionTitle, { color: c.text }]}>
            Sale complete
          </Text>
          <Text style={[ui.caption, { color: c.muted }]}>
            Ref #{receipt.id.slice(0, 8).toUpperCase()}
          </Text>
        </View>
      </View>
      <Divider />
      {rows.map(([label, cents]) => (
        <View key={label} style={ui.spread}>
          <Text style={[ui.body, { color: c.muted }]}>{label}</Text>
          <Text style={[ui.money, { color: c.text, fontSize: 15 }]}>
            {formatMoney(cents)}
          </Text>
        </View>
      ))}
      <View style={ui.spread}>
        <Text style={[ui.sectionTitle, { color: c.text }]}>Change</Text>
        <Text style={[ui.money, styles.total, { color: c.accent }]}>
          {formatMoney(receipt.change)}
        </Text>
      </View>
      <View style={ui.row}>
        <View style={ui.grow}>
          <Button
            title="New sale"
            icon="scan-outline"
            onPress={() => router.navigate("/till")}
          />
        </View>
        <View style={ui.grow}>
          <Button
            title="View sales"
            secondary
            onPress={() => router.navigate("/sales")}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  footer: { borderTopWidth: 1, paddingTop: 14, gap: 12 },
  total: { fontSize: 22, letterSpacing: -0.3 },
  check: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
