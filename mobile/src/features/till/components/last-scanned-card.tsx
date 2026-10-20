import { Text, View } from "react-native";

import { Card, Stepper, Thumb, ui, usePalette } from "@/components/shop-ui";
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
    <Card style={{ padding: 12 }}>
      <View style={ui.row}>
        <Thumb uri={item.photo_uri} name={item.product_name} size={44} />
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
        <Text style={[ui.caption, { color: c.accent }]}>Added to cart</Text>
        <Stepper
          value={item.quantity}
          name={name}
          max={item.stock}
          onChange={onQuantity}
        />
      </View>
    </Card>
  );
}
