import { Pressable, ScrollView, Text, View } from "react-native";

import { Sheet } from "@/components/sheet";
import { Label, ui, usePalette } from "@/components/shop-ui";
import type { ProductWithVariants } from "@/db/store";
import { variantLabel } from "@/domain/units";
import { formatMoney } from "@/lib/money";

/** Picks a size when a product (not a specific pack) was chosen or recognised. */
export function VariantPickerSheet({
  product,
  onPick,
  onClose,
}: {
  product: ProductWithVariants | null;
  onPick: (variantId: string) => void;
  onClose: () => void;
}) {
  const c = usePalette();
  return (
    <Sheet
      visible={product !== null}
      title={product?.name ?? ""}
      subtitle="Which size?"
      onClose={onClose}
    >
      <ScrollView contentContainerStyle={ui.stack}>
        {product?.variants.map((variant) => {
          const soldOut = variant.stock === 0;
          return (
            <Pressable
              key={variant.id}
              accessibilityRole="button"
              accessibilityState={{ disabled: soldOut }}
              accessibilityLabel={`${variantLabel(variant)}, ${formatMoney(variant.price_cents)}${soldOut ? ", out of stock" : ""}`}
              disabled={soldOut}
              onPress={() => onPick(variant.id)}
              style={({ pressed }) => [
                ui.card,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  opacity: soldOut ? 0.5 : pressed ? 0.75 : 1,
                },
              ]}
            >
              <View style={ui.spread}>
                <View style={ui.grow}>
                  <Text style={[ui.sectionTitle, { color: c.text }]}>
                    {variantLabel(variant)}
                  </Text>
                  <Label muted>
                    {soldOut ? "Out of stock" : `${variant.stock} in stock`}
                  </Label>
                </View>
                <Text style={[ui.sectionTitle, { color: c.accent }]}>
                  {formatMoney(variant.price_cents)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}
