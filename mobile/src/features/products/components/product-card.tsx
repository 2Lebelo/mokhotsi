import { Image, Text, View } from "react-native";

import { Button, Card, Label, ui, usePalette } from "@/components/shop-ui";
import type { ProductWithVariants } from "@/db/store";
import { variantLabel } from "@/domain/units";
import { formatMoney } from "@/lib/money";

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
    <Card>
      <View style={ui.row}>
        {product.photo_uri ? (
          <Image
            source={{ uri: product.photo_uri }}
            accessibilityLabel={product.name}
            style={ui.thumbnail}
          />
        ) : (
          <View
            style={[
              ui.thumbnail,
              {
                backgroundColor: c.tint,
                alignItems: "center",
                justifyContent: "center",
              },
            ]}
          >
            <Text style={{ color: c.accent, fontSize: 24, fontWeight: "800" }}>
              {product.name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={ui.grow}>
          <Text style={[ui.sectionTitle, { color: c.text }]}>
            {product.name}
          </Text>
          <Label muted>{product.category}</Label>
        </View>
        <Button
          title="Edit"
          secondary
          accessibilityLabel={`Edit ${product.name}`}
          onPress={onEdit}
        />
      </View>
      {product.variants.map((variant) => {
        const quantity = inCart.get(variant.id) ?? 0;
        const name = `${product.name} ${variantLabel(variant)}`;
        return (
          <View
            key={variant.id}
            style={[
              ui.spread,
              { borderTopWidth: 1, borderColor: c.border, paddingTop: 12 },
            ]}
          >
            <View style={ui.grow}>
              <Text style={[ui.body, { color: c.text, fontWeight: "700" }]}>
                {variantLabel(variant)} ·{" "}
                <Text style={{ color: c.accent }}>
                  {formatMoney(variant.price_cents)}
                </Text>
              </Text>
              <Text
                style={[
                  ui.caption,
                  { color: variant.stock === 0 ? c.danger : c.muted },
                ]}
              >
                {variant.stock === 0
                  ? "Out of stock"
                  : `${variant.stock} in stock`}
                {quantity > 0 ? ` · ${quantity} in cart` : ""}
              </Text>
            </View>
            <Button
              title="Add"
              accessibilityLabel={`Add ${name} to cart`}
              disabled={quantity >= variant.stock}
              onPress={() => onAdd(variant.id)}
            />
          </View>
        );
      })}
    </Card>
  );
}
