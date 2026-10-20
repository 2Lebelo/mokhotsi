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
  IconButton,
  Screen,
  ui,
} from "@/components/shop-ui";
import { useToast } from "@/components/toast";
import { useShop } from "@/db/ShopProvider";
import { variantLabel } from "@/domain/units";
import { ProductCard } from "@/features/products/components/product-card";
import { matchesProduct } from "@/features/products/search";

export default function CatalogueScreen() {
  const { store, refresh } = useShop();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
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
      toast.success(
        `${item.product_name} · ${variantLabel(item)} added to cart`,
      );
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  }

  return (
    <Screen scroll={false}>
      <Heading
        title="Catalogue"
        subtitle={`${products.length} ${products.length === 1 ? "product" : "products"} · prices in LSL`}
        action={
          <IconButton
            icon="add"
            variant="accent"
            size={44}
            accessibilityLabel="New product"
            onPress={() => router.push("/register")}
          />
        }
      />
      <Field
        icon="search"
        placeholder="Search name, category, or barcode"
        accessibilityLabel="Search products"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
      {categories.length > 0 && (
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[ui.row, { gap: 8 }]}
          >
            {[null, ...categories].map((value) => (
              <Chip
                key={value ?? "__all"}
                label={value ?? "All"}
                accessibilityLabel={value ?? "All products"}
                selected={value === activeCategory}
                onPress={() => setCategory(value)}
              />
            ))}
          </ScrollView>
        </View>
      )}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          products.length ? (
            <Empty
              icon="search-outline"
              title="No matching products"
              description="Try another search or category."
            />
          ) : (
            <Empty
              icon="book-outline"
              title="Your catalogue starts here"
              description="Add a product with a photo, its sizes, prices, and stock."
              action={
                <Button
                  title="New product"
                  icon="add"
                  onPress={() => router.push("/register")}
                />
              }
            />
          )
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
