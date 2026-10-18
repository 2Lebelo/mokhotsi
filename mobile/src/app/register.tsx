import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from "react-native";

import {
  Button,
  Card,
  errorMessage,
  Field,
  Heading,
  Notice,
  Screen,
  ui,
} from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import { removePhoto, savePhoto } from "@/features/photos";
import { parsePrice, parseStock, priceInput } from "@/lib/money";

export default function RegistrationScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { store, refresh } = useShop();
  const existing = id ? store.product(id) : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [price, setPrice] = useState(
    existing ? priceInput(existing.price_cents) : "",
  );
  const [stock, setStock] = useState(existing ? String(existing.stock) : "");
  const [barcode, setBarcode] = useState(existing?.barcode ?? "");
  const [photo, setPhoto] = useState<string | null>(
    existing?.photo_uri ?? null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const categories = [
    ...new Set(store.products().map((p) => p.category)),
  ].sort();

  async function choosePhoto(camera: boolean) {
    setError("");
    setBusy(true);
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted)
          throw new Error(
            "Allow camera access in your phone settings, or choose a photo from your library.",
          );
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 0.7,
        allowsEditing: true,
        aspect: [1, 1],
      };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled && result.assets[0]) setPhoto(result.assets[0].uri);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (saving.current || busy) return;
    saving.current = true;
    setBusy(true);
    setError("");
    let savedPhoto: string | null = null;
    let committed = false;
    try {
      if (!name.trim()) throw new Error("Enter a product name.");
      if (!category.trim()) throw new Error("Enter a category.");
      const priceCents = parsePrice(price);
      const quantity = parseStock(stock);
      savedPhoto = savePhoto(photo);
      store.saveProduct(
        {
          name,
          category,
          price_cents: priceCents,
          stock: quantity,
          barcode: barcode || null,
          photo_uri: savedPhoto,
        },
        id,
      );
      committed = true;
      if (existing?.photo_uri && existing.photo_uri !== savedPhoto)
        removePhoto(existing.photo_uri);
      refresh();
      router.replace("/catalogue");
    } catch (cause) {
      if (!committed && savedPhoto && savedPhoto !== photo)
        removePhoto(savedPhoto);
      setError(errorMessage(cause));
    } finally {
      // Keep the guard until navigation unmounts the successfully saved form.
      if (!committed) saving.current = false;
      setBusy(false);
    }
  }

  if (id && !existing)
    return (
      <Screen>
        <Heading
          title="Product not found"
          subtitle="Return to the catalogue and choose a product."
        />
        <Button
          title="Back to catalogue"
          onPress={() => router.replace("/catalogue")}
        />
      </Screen>
    );
  return (
    <KeyboardAvoidingView
      style={ui.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen>
        <Button
          title="Back to catalogue"
          secondary
          disabled={busy}
          onPress={() => router.replace("/catalogue")}
        />
        <Heading
          title={existing ? "Edit product" : "Register product"}
          subtitle="Add the details your shop needs. Saved on this device."
        />
        {!!error && <Notice message={error} error />}
        <Field
          label="Product name"
          placeholder="e.g. Maize meal 2.5 kg"
          value={name}
          onChangeText={setName}
          maxLength={120}
          editable={!busy}
        />
        <Field
          label="Category"
          placeholder="e.g. Groceries"
          value={category}
          onChangeText={setCategory}
          maxLength={80}
          editable={!busy}
        />
        {categories.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={ui.row}
          >
            {categories.map((value) => (
              <Button
                key={value}
                title={value}
                secondary
                disabled={busy}
                onPress={() => setCategory(value)}
              />
            ))}
          </ScrollView>
        )}
        <View style={ui.row}>
          <View style={ui.grow}>
            <Field
              label="Selling price (LSL)"
              placeholder="0.00"
              keyboardType="decimal-pad"
              value={price}
              onChangeText={setPrice}
              maxLength={18}
              editable={!busy}
            />
          </View>
          <View style={ui.grow}>
            <Field
              label="Stock quantity"
              placeholder="0"
              keyboardType="number-pad"
              value={stock}
              onChangeText={setStock}
              maxLength={16}
              editable={!busy}
            />
          </View>
        </View>
        <Field
          label="Barcode (optional)"
          placeholder="Enter the product barcode"
          value={barcode}
          onChangeText={setBarcode}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={120}
          editable={!busy}
        />
        <Card>
          {photo && (
            <Image
              source={{ uri: photo }}
              accessibilityLabel="Product photo preview"
              style={{ width: "100%", height: 200, borderRadius: 12 }}
              resizeMode="contain"
            />
          )}
          <View style={ui.row}>
            <View style={ui.grow}>
              <Button
                title="Choose photo"
                secondary
                disabled={busy}
                onPress={() => void choosePhoto(false)}
              />
            </View>
            <View style={ui.grow}>
              <Button
                title="Take photo"
                secondary
                disabled={busy}
                onPress={() => void choosePhoto(true)}
              />
            </View>
          </View>
          {photo && (
            <Button
              title="Remove photo"
              secondary
              disabled={busy}
              onPress={() => setPhoto(null)}
            />
          )}
        </Card>
        <Button
          title={existing ? "Save changes" : "Save product"}
          busy={busy}
          onPress={save}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}
