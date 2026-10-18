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
    <View
      style={[
        styles.bar,
        { backgroundColor: c.surface, borderColor: c.border },
      ]}
    >
      <View style={ui.grow}>
        <Text style={[ui.caption, { color: c.muted }]}>
          {count} {count === 1 ? "item" : "items"} in cart
        </Text>
        <Text style={[ui.sectionTitle, { color: c.text }]}>
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
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
  },
});
