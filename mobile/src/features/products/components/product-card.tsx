import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { Button, Divider, Thumb, ui, usePalette } from "@/components/shop-ui";
import type { ProductWithVariants } from "@/db/store";
import { variantLabel } from "@/domain/units";
import { formatMoney } from "@/lib/money";

/** A catalogue entry: tap it to edit; each size has its own price and Add. */
export function ProductCard({
  product,
  inCart,
  onEdit,
  onAdd,
}: {
  product: ProductWithVariants;
  /** Cart quantity per size id. */
  inCart: ReadonlyMap<string, number>;
  onEdit: () => void;
  onAdd: (variantId: string) => void;
}) {
  const c = usePalette();
  return (
    <View
      style={[ui.card, { borderColor: c.border, backgroundColor: c.surface }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${product.name}, ${product.category}. Edit product`}
        onPress={onEdit}
        style={({ pressed }) => [ui.row, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Thumb uri={product.photo_uri} name={product.name} size={52} />
        <View style={ui.grow}>
          <Text numberOfLines={1} style={[ui.sectionTitle, { color: c.text }]}>
            {product.name}
          </Text>
          <Text numberOfLines={1} style={[ui.caption, { color: c.muted }]}>
            {product.category}
            {product.variants.length > 1
              ? ` · ${product.variants.length} sizes`
              : ""}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={c.faint} />
      </Pressable>
      {product.variants.map((variant) => {
        const quantity = inCart.get(variant.id) ?? 0;
        const name = `${product.name} ${variantLabel(variant)}`;
        const soldOut = variant.stock === 0;
        return (
          <View key={variant.id} style={ui.stack}>
            <Divider />
            <View style={ui.spread}>
              <View style={ui.grow}>
                <Text style={[ui.body, { color: c.text }]}>
                  {variantLabel(variant)}
                  <Text style={{ color: c.faint }}> · </Text>
                  <Text style={[ui.money, { color: c.text }]}>
                    {formatMoney(variant.price_cents)}
                  </Text>
                </Text>
                <Text
                  style={[ui.caption, { color: soldOut ? c.danger : c.muted }]}
                >
                  {soldOut ? "Out of stock" : `${variant.stock} in stock`}
                  {quantity > 0 ? ` · ${quantity} in cart` : ""}
                </Text>
              </View>
              <Button
                title="Add"
                icon="add"
                size="sm"
                secondary
                accessibilityLabel={`Add ${name} to cart`}
                disabled={quantity >= variant.stock}
                onPress={() => onAdd(variant.id)}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}
