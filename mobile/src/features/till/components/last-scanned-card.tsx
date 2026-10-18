import { Text, View } from "react-native";

import { Button, Card, Label, ui, usePalette } from "@/components/shop-ui";
import type { CartItem } from "@/db/store";
import { variantLabel } from "@/domain/units";
import { formatMoney } from "@/lib/money";

export function LastScannedCard({
  item,
  onQuantity,
}: {
  item: CartItem;
  onQuantity: (quantity: number) => void;
}) {
  const c = usePalette();
  const name = `${item.product_name} · ${variantLabel(item)}`;
  return (
    <Card>
      <View style={ui.spread}>
        <View style={ui.grow}>
          <Text numberOfLines={1} style={[ui.sectionTitle, { color: c.text }]}>
            {item.product_name}
          </Text>
          <Label muted>
            {variantLabel(item)} · {formatMoney(item.price_cents)} each
          </Label>
        </View>
        <Text style={[ui.sectionTitle, { color: c.accent }]}>
          {formatMoney(item.price_cents * item.quantity)}
        </Text>
      </View>
      <View style={ui.row}>
        <Button
          title="−"
          secondary
          accessibilityLabel={`Decrease ${name} quantity`}
          onPress={() => onQuantity(item.quantity - 1)}
        />
        <Text
          accessibilityLabel={`${name} quantity ${item.quantity}`}
          style={[
            ui.sectionTitle,
            { color: c.text, minWidth: 32, textAlign: "center" },
          ]}
        >
          {item.quantity}
        </Text>
        <Button
          title="+"
          secondary
          disabled={item.quantity >= item.stock}
          accessibilityLabel={`Increase ${name} quantity`}
          onPress={() => onQuantity(item.quantity + 1)}
        />
      </View>
    </Card>
  );
}
