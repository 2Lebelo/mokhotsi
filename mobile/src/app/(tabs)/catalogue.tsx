import { router } from "expo-router";
import { useState } from "react";
import { FlatList, ScrollView, View } from "react-native";

import {
  Button,
  Chip,
  Empty,
  errorMessage,
  Field,
  Heading,
  Notice,
  Screen,
  ui,
} from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import { variantLabel } from "@/domain/units";
import { ProductCard } from "@/features/products/components/product-card";
import { matchesProduct } from "@/features/products/search";

export default function CatalogueScreen() {
  const { store, refresh } = useShop();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const products = store.catalogue.products();
  const categories = store.catalogue.categories();
  const activeCategory =
    category && categories.includes(category) ? category : null;
  const filtered = products.filter(
    (p) =>
      (!activeCategory || p.category === activeCategory) &&
      matchesProduct(p, query),
  );
  const inCart = new Map(
    store.cart.items().map((item) => [item.id, item.quantity]),
  );

  function add(variantId: string) {
    try {
      const item = store.cart.add(variantId);
      refresh();
      setError(false);
      setMessage(`${item.product_name} · ${variantLabel(item)} added to cart.`);
    } catch (cause) {
      setError(true);
      setMessage(errorMessage(cause));
    }
  }

  return (
    <Screen scroll={false}>
      <Heading
        title="Product catalogue"
        subtitle={`${products.length} ${products.length === 1 ? "product" : "products"} · prices in LSL`}
      />
      <Button
        title="Register product"
        onPress={() => router.push("/register")}
      />
      <Field
        label="Search products"
        placeholder="Name, category, or barcode"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
      />
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={ui.row}
        >
          {[null, ...categories].map((value) => (
            <Chip
              key={value ?? "__all"}
              label={value ?? "All products"}
              selected={value === activeCategory}
              onPress={() => setCategory(value)}
            />
          ))}
        </ScrollView>
      </View>
      {!!message && <Notice message={message} error={error} />}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Empty
            title={
              products.length
                ? "No matching products"
                : "Your catalogue starts here"
            }
            description={
              products.length
                ? "Try another search or category."
                : "Add a product with its sizes, prices, and stock."
            }
          />
        }
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            inCart={inCart}
            onAdd={add}
            onEdit={() =>
              router.push({ pathname: "/register", params: { id: item.id } })
            }
          />
        )}
      />
    </Screen>
  );
}
