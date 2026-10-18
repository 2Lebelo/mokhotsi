import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { Alert, FlatList, Text, View } from "react-native";

import {
  Button,
  Card,
  Empty,
  errorMessage,
  Heading,
  Label,
  Notice,
  Screen,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import { cartTotal } from "@/db/store";
import { formatMoney } from "@/lib/money";

export default function CartScreen() {
  const { store, refresh } = useShop();
  const c = usePalette();
  const items = store.cart();
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ id: string; total: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  let total = 0;
  let totalError = "";
  try {
    total = cartTotal(items);
  } catch (cause) {
    totalError = errorMessage(cause);
  }
  const exceedsStock = items.some((item) => item.quantity > item.stock);

  function changeQuantity(id: string, quantity: number) {
    try {
      store.setQuantity(id, quantity);
      setError("");
      setReceipt(null);
      refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function checkout() {
    if (submitting.current) return;
    submitting.current = true;
    const saleId = randomUUID();
    Alert.alert(
      "Complete sale?",
      `Record a sale of ${formatMoney(total)}? Stock will be reduced when you confirm.`,
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => {
            submitting.current = false;
          },
        },
        {
          text: "Complete sale",
          onPress: () => {
            setBusy(true);
            try {
              store.checkout(saleId);
              setReceipt({ id: saleId, total });
              setError("");
              refresh();
            } catch (cause) {
              setError(errorMessage(cause));
            } finally {
              submitting.current = false;
              setBusy(false);
            }
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          submitting.current = false;
        },
      },
    );
  }

  function clear() {
    Alert.alert("Clear cart?", "Remove all products from this cart?", [
      { text: "Keep cart", style: "cancel" },
      {
        text: "Clear cart",
        style: "destructive",
        onPress: () => {
          try {
            store.clearCart();
            setError("");
            refresh();
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
        title="Your cart"
        subtitle="Review quantities and complete your sale."
      />
      {!!(error || totalError) && (
        <Notice message={error || totalError} error />
      )}
      {exceedsStock && (
        <Notice
          message="Some quantities exceed available stock. Reduce them or update the product’s stock before checkout."
          error
        />
      )}
      {receipt && items.length === 0 && (
        <Card>
          <Notice message={`Sale saved · ${formatMoney(receipt.total)}`} />
          <Label>Reference: {receipt.id.slice(0, 8).toUpperCase()}</Label>
          <Button
            title="View sales history"
            secondary
            onPress={() => router.navigate("/sales")}
          />
        </Card>
      )}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 12, paddingBottom: 12 }}
        ListEmptyComponent={
          <Empty
            title="Your cart is empty"
            description="Choose products from the catalogue to start a sale."
            action={
              <Button
                title="Browse catalogue"
                onPress={() => router.navigate("/catalogue")}
              />
            }
          />
        }
        renderItem={({ item }) => (
          <Card>
            <Text style={[ui.sectionTitle, { color: c.text }]}>
              {item.name}
            </Text>
            <Label muted>
              {formatMoney(item.price_cents)} each · {item.stock} available
            </Label>
            <View style={ui.spread}>
              <View style={ui.row}>
                <Button
                  title="−"
                  secondary
                  disabled={busy}
                  accessibilityLabel={`Decrease ${item.name} quantity`}
                  onPress={() => changeQuantity(item.id, item.quantity - 1)}
                />
                <Text
                  accessibilityLabel={`${item.name} quantity ${item.quantity}`}
                  style={[ui.sectionTitle, { color: c.text }]}
                >
                  {item.quantity}
                </Text>
                <Button
                  title="+"
                  secondary
                  disabled={busy || item.quantity >= item.stock}
                  accessibilityLabel={`Increase ${item.name} quantity`}
                  onPress={() => changeQuantity(item.id, item.quantity + 1)}
                />
              </View>
              <Text style={[ui.sectionTitle, { color: c.text }]}>
                {formatMoney(item.price_cents * item.quantity)}
              </Text>
            </View>
            <Button
              title="Remove"
              secondary
              disabled={busy}
              accessibilityLabel={`Remove ${item.name} from cart`}
              onPress={() => changeQuantity(item.id, 0)}
            />
          </Card>
        )}
      />
      {items.length > 0 && (
        <Card>
          <View style={ui.spread}>
            <Label>Total · LSL</Label>
            <Text style={[ui.title, { color: c.text }]}>
              {totalError ? "—" : formatMoney(total)}
            </Text>
          </View>
          <Button
            title="Complete sale"
            busy={busy}
            disabled={exceedsStock || !!totalError}
            onPress={checkout}
          />
          <Button
            title="Clear cart"
            secondary
            disabled={busy}
            onPress={clear}
          />
        </Card>
      )}
    </Screen>
  );
}
