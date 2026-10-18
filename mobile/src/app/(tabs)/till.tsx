import { router } from "expo-router";
import { Text, View } from "react-native";

import { Button, Notice, Screen, ui, usePalette } from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import { cartTotal } from "@/db/store";
import { ScannerCamera } from "@/features/scanner/scanner-camera";
import { BasketBar } from "@/features/till/components/basket-bar";
import { LastScannedCard } from "@/features/till/components/last-scanned-card";
import { ProductSearchSheet } from "@/features/till/components/product-search-sheet";
import { UnknownCodeSheet } from "@/features/till/components/unknown-code-sheet";
import { VariantPickerSheet } from "@/features/till/components/variant-picker-sheet";
import { useTill } from "@/features/till/use-till";

export default function TillScreen() {
  const { store } = useShop();
  const c = usePalette();
  const till = useTill();
  const { sheet, lastVariantId, error } = till.state;

  const items = store.cart.items();
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  let total: number | null;
  try {
    total = cartTotal(items);
  } catch {
    total = null;
  }
  const last = items.find((item) => item.id === lastVariantId);
  const choosing =
    sheet.kind === "choose-variant"
      ? store.catalogue.product(sheet.productId)
      : null;

  return (
    <Screen scroll={false}>
      <View style={ui.spread}>
        <View style={ui.grow}>
          <Text style={[ui.eyebrow, { color: c.accent, marginBottom: 2 }]}>
            TILL
          </Text>
          <Text
            accessibilityRole="header"
            style={[ui.sectionTitle, { color: c.text }]}
          >
            Scan to sell
          </Text>
        </View>
        <Button title="Search" secondary onPress={till.openSearch} />
      </View>

      <ScannerCamera
        active={till.scanning}
        onRecognition={till.handleRecognition}
        style={ui.flex}
      />

      {!!error && <Notice message={error} error />}
      {last && (
        <LastScannedCard
          item={last}
          onQuantity={(quantity) => till.setQuantity(last.id, quantity)}
        />
      )}
      <BasketBar
        count={count}
        total={total}
        onCheckout={() => router.navigate("/cart")}
      />

      <UnknownCodeSheet
        code={sheet.kind === "unknown" ? sheet.code : null}
        onClose={till.closeSheet}
        onRegister={(barcode) => {
          till.closeSheet();
          router.push({ pathname: "/register", params: { barcode } });
        }}
      />
      <VariantPickerSheet
        product={choosing}
        onPick={till.addVariant}
        onClose={till.closeSheet}
      />
      <ProductSearchSheet
        visible={sheet.kind === "search"}
        onPick={till.chooseProduct}
        onClose={till.closeSheet}
      />
    </Screen>
  );
}
