import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

import { Sheet } from "@/components/sheet";
import { Empty, Field, Label, ui, usePalette } from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import { variantLabel } from "@/domain/units";
import { matchesProduct } from "@/features/products/search";
import { formatMoney } from "@/lib/money";

/** Manual lookup at the till, for goods without a readable barcode. */
export function ProductSearchSheet({
  visible,
  onPick,
  onClose,
}: {
  visible: boolean;
  onPick: (productId: string) => void;
  onClose: () => void;
}) {
  const { store } = useShop();
  const c = usePalette();
  const [query, setQuery] = useState("");
  const products = visible
    ? store.catalogue
        .products()
        .filter((p) => p.variants.length > 0 && matchesProduct(p, query))
    : [];

  function close() {
    setQuery("");
    onClose();
  }

  return (
    <Sheet visible={visible} title="Find a product" onClose={close}>
      <Field
        label="Search"
        placeholder="Name, category, or barcode"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoFocus
      />
      <FlatList
        data={products}
        keyExtractor={(product) => product.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 10, paddingBottom: 8 }}
        ListEmptyComponent={
          <Empty
            title="No matching products"
            description="Try another name, or register the product from the catalogue."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setQuery("");
              onPick(item.id);
            }}
            style={({ pressed }) => [
              ui.card,
              {
                backgroundColor: c.surface,
                borderColor: c.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <View style={ui.spread}>
              <View style={ui.grow}>
                <Text style={[ui.sectionTitle, { color: c.text }]}>
                  {item.name}
                </Text>
                <Label muted>
                  {item.variants.length === 1
                    ? `${variantLabel(item.variants[0])} · ${formatMoney(item.variants[0].price_cents)}`
                    : `${item.variants.length} sizes`}
                </Label>
              </View>
            </View>
          </Pressable>
        )}
      />
    </Sheet>
  );
}
