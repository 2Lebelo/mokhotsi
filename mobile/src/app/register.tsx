import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useReducer, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";

import {
  Button,
  Chip,
  errorMessage,
  Field,
  Heading,
  Notice,
  Screen,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import type { ProductWithVariants } from "@/db/store";
import { variantLabel } from "@/domain/units";
import { removePhoto, savePhoto } from "@/features/photos";
import { PhotoField } from "@/features/products/components/photo-field";
import { VariantEditor } from "@/features/products/components/variant-editor";
import {
  draftFromProduct,
  productFormReducer,
  validateProductDraft,
  type DraftErrors,
  type VariantField,
} from "@/features/products/product-form";
import { BarcodeCaptureModal } from "@/features/scanner/barcode-capture-modal";

/** Returns to whichever screen opened the form: the catalogue or the till. */
function leave() {
  if (router.canGoBack()) router.back();
  else router.replace("/catalogue");
}

export default function RegistrationScreen() {
  const { id, barcode } = useLocalSearchParams<{
    id?: string;
    barcode?: string;
  }>();
  const { store } = useShop();
  const existing = id ? store.catalogue.product(id) : null;
  if (id && !existing)
    return (
      <Screen>
        <Heading
          title="Product not found"
          subtitle="Return to the catalogue and choose a product."
        />
        <Button title="Back" onPress={leave} />
      </Screen>
    );
  return <ProductForm existing={existing} barcode={barcode} />;
}

const noErrors: DraftErrors = { variants: {} };

function ProductForm({
  existing,
  barcode,
}: {
  existing: ProductWithVariants | null;
  barcode?: string;
}) {
  const { store, refresh } = useShop();
  const c = usePalette();
  const [draft, dispatch] = useReducer(productFormReducer, null, () =>
    draftFromProduct(existing, randomUUID, barcode),
  );
  const [errors, setErrors] = useState<DraftErrors>(noErrors);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanKey, setScanKey] = useState<string | null>(null);
  const saving = useRef(false);
  const categories = store.catalogue.categories();

  function setVariantError(key: string, field: VariantField, message?: string) {
    setErrors((current) => ({
      ...current,
      variants: {
        ...current.variants,
        [key]: { ...current.variants[key], [field]: message },
      },
    }));
  }

  function changeVariant(key: string, field: VariantField, value: string) {
    dispatch({ type: "set-variant", key, field, value });
    if (errors.variants[key]?.[field]) setVariantError(key, field, undefined);
  }

  function captureBarcode(code: string) {
    const key = scanKey;
    setScanKey(null);
    if (!key) return;
    changeVariant(key, "barcode", code);
    const owner = store.catalogue.variantByBarcode(code);
    if (owner && owner.product_id !== existing?.id)
      setVariantError(
        key,
        "barcode",
        `Already used by ${owner.product_name} · ${variantLabel(owner)}.`,
      );
  }

  function save() {
    if (saving.current) return;
    const result = validateProductDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      setError("Check the highlighted fields.");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    setErrors(noErrors);
    let savedPhoto: string | null = null;
    let committed = false;
    try {
      savedPhoto = savePhoto(draft.photo);
      store.catalogue.saveProduct(
        { ...result.input, photo_uri: savedPhoto },
        existing?.id,
      );
      committed = true;
      if (existing?.photo_uri && existing.photo_uri !== savedPhoto)
        removePhoto(existing.photo_uri);
      refresh();
      leave();
    } catch (cause) {
      if (!committed && savedPhoto && savedPhoto !== draft.photo)
        removePhoto(savedPhoto);
      setError(errorMessage(cause));
    } finally {
      // Keep the guard until navigation unmounts the successfully saved form.
      if (!committed) saving.current = false;
      setBusy(false);
    }
  }

  const scanIndex = draft.variants.findIndex((v) => v.key === scanKey);

  return (
    <KeyboardAvoidingView
      style={ui.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen>
        <Button title="Back" secondary disabled={busy} onPress={leave} />
        <Heading
          title={existing ? "Edit product" : "Register product"}
          subtitle="Add each size you sell with its own price, stock, and barcode."
        />
        {!!error && <Notice message={error} error />}
        <Field
          label="Product name"
          placeholder="e.g. Maize meal"
          value={draft.name}
          onChangeText={(value) =>
            dispatch({ type: "set-field", field: "name", value })
          }
          maxLength={120}
          editable={!busy}
          error={errors.name}
        />
        <Field
          label="Category"
          placeholder="e.g. Groceries"
          value={draft.category}
          onChangeText={(value) =>
            dispatch({ type: "set-field", field: "category", value })
          }
          maxLength={80}
          editable={!busy}
          error={errors.category}
        />
        {categories.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={ui.row}
          >
            {categories.map((value) => (
              <Chip
                key={value}
                label={value}
                selected={value === draft.category.trim()}
                onPress={() =>
                  dispatch({ type: "set-field", field: "category", value })
                }
              />
            ))}
          </ScrollView>
        )}

        <View>
          <Text style={[ui.sectionTitle, { color: c.text }]}>
            Sizes and prices
          </Text>
          <Text style={[ui.body, { color: c.muted }]}>
            e.g. Sugar 500 g and Sugar 2 kg are two sizes of one product.
          </Text>
        </View>
        {draft.variants.map((variant, index) => (
          <VariantEditor
            key={variant.key}
            index={index}
            variant={variant}
            errors={errors.variants[variant.key]}
            disabled={busy}
            canRemove={draft.variants.length > 1}
            onChange={(field, value) =>
              changeVariant(variant.key, field, value)
            }
            onRemove={() =>
              dispatch({ type: "remove-variant", key: variant.key })
            }
            onScan={() => setScanKey(variant.key)}
          />
        ))}
        <Button
          title="Add another size"
          secondary
          disabled={busy}
          onPress={() => dispatch({ type: "add-variant", key: randomUUID() })}
        />

        <PhotoField
          uri={draft.photo}
          disabled={busy}
          onChange={(uri) => dispatch({ type: "set-photo", uri })}
          onError={setError}
        />
        <Button
          title={existing ? "Save changes" : "Save product"}
          busy={busy}
          onPress={save}
        />
      </Screen>
      <BarcodeCaptureModal
        visible={scanKey !== null}
        title={`For size ${scanIndex + 1}${draft.name.trim() ? ` of ${draft.name.trim()}` : ""}.`}
        onCapture={captureBarcode}
        onClose={() => setScanKey(null)}
      />
    </KeyboardAvoidingView>
  );
}
