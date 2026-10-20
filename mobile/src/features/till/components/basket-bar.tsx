import { StyleSheet, Text, View } from "react-native";

import { Button, ui, usePalette } from "@/components/shop-ui";
import { formatMoney } from "@/lib/money";

export function BasketBar({
  count,
  total,
  onCheckout,
}: {
  count: number;
  /** null when the total cannot be computed (overflow); the cart explains why. */
  total: number | null;
  onCheckout: () => void;
}) {
  const c = usePalette();
  return (
    <View style={[styles.bar, { backgroundColor: c.subtle }]}>
      <View style={ui.grow}>
        <Text style={[ui.caption, { color: c.muted }]}>
          {count} {count === 1 ? "item" : "items"} in cart
        </Text>
        <Text style={[ui.money, { color: c.text, fontSize: 20 }]}>
          {total === null ? "—" : formatMoney(total)}
        </Text>
      </View>
      <Button title="Checkout" disabled={count === 0} onPress={onCheckout} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    padding: 12,
    paddingLeft: 16,
  },
});
