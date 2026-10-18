import { router } from "expo-router";
import { useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  Button,
  Card,
  Empty,
  errorMessage,
  Field,
  Heading,
  Label,
  Notice,
  Screen,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import { formatMoney } from "@/lib/money";

export default function CatalogueScreen() {
  const { store, refresh } = useShop();
  const c = usePalette();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const products = store.products();
  const categories = [...new Set(products.map((p) => p.category))].sort(
    (a, b) => a.localeCompare(b),
  );
  const activeCategory =
    category && categories.includes(category) ? category : null;
  const search = query.trim().toLocaleLowerCase();
  const filtered = products.filter(
    (p) =>
      (!activeCategory || p.category === activeCategory) &&
      [p.name, p.category, p.barcode ?? ""].some((value) =>
        value.toLocaleLowerCase().includes(search),
      ),
  );
  const cart = store.cart();

  function add(id: string, name: string) {
    try {
      store.addToCart(id);
      refresh();
      setError(false);
      setMessage(`${name} added to cart.`);
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
            <Pressable
              key={value ?? "__all"}
              accessibilityRole="button"
              accessibilityState={{ selected: value === activeCategory }}
              onPress={() => setCategory(value)}
              style={{
                minHeight: 44,
                justifyContent: "center",
                paddingHorizontal: 16,
                borderRadius: 22,
                backgroundColor:
                  value === activeCategory ? c.accent : c.surface,
              }}
            >
              <Text
                style={{
                  fontWeight: "600",
                  color: value === activeCategory ? c.background : c.text,
                }}
              >
                {value ?? "All products"}
              </Text>
            </Pressable>
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
                : "Add a product with its price, category, and stock quantity."
            }
          />
        }
        renderItem={({ item }) => {
          const inCart = cart.find((row) => row.id === item.id)?.quantity ?? 0;
          return (
            <Card>
              <View style={ui.row}>
                {item.photo_uri ? (
                  <Image
                    source={{ uri: item.photo_uri }}
                    accessibilityLabel={item.name}
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
                    <Text
                      style={{
                        color: c.accent,
                        fontSize: 24,
                        fontWeight: "800",
                      }}
                    >
                      {item.name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={ui.grow}>
                  <Text style={[ui.sectionTitle, { color: c.text }]}>
                    {item.name}
                  </Text>
                  <Label muted>{item.category}</Label>
                  <Text
                    style={[
                      ui.caption,
                      { color: item.stock === 0 ? c.danger : c.muted },
                    ]}
                  >
                    {item.stock === 0
                      ? "Out of stock"
                      : `${item.stock} in stock`}
                    {inCart > 0 ? ` · ${inCart} in cart` : ""}
                  </Text>
                </View>
              </View>
              <View style={ui.spread}>
                <Text style={[ui.sectionTitle, { color: c.accent }]}>
                  {formatMoney(item.price_cents)}
                </Text>
                <View style={ui.row}>
                  <Button
                    title="Edit"
                    secondary
                    accessibilityLabel={`Edit ${item.name}`}
                    onPress={() =>
                      router.push({
                        pathname: "/register",
                        params: { id: item.id },
                      })
                    }
                  />
                  <Button
                    title="Add"
                    accessibilityLabel={`Add ${item.name} to cart`}
                    disabled={inCart >= item.stock}
                    onPress={() => add(item.id, item.name)}
                  />
                </View>
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}
