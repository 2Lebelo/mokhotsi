import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useReducer, useRef, useState } from "react";
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
  Notice,
  Screen,
  TopBar,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useCan } from "@/auth/session-provider";
import { useToast } from "@/components/toast";
import { useShop } from "@/db/ShopProvider";
import type { ProductWithVariants } from "@/db/store";
import { variantLabel } from "@/domain/units";
import { fileSha256 } from "@/features/files";
import {
  discardStagedPhoto,
  photoExists,
  removePhoto,
  savePhoto,
} from "@/features/photos";
import { PhotoField } from "@/features/products/components/photo-field";
import { VariantEditor } from "@/features/products/components/variant-editor";
import {
  draftFromProduct,
  lostPhotoMessage,
  lostPhotoSlots,
  PHOTO_SLOTS,
  productFormReducer,
  validateProductDraft,
  type DraftErrors,
  type PhotoSlot,
  type VariantField,
} from "@/features/products/product-form";
import { BarcodeCaptureModal } from "@/features/scanner/barcode-capture-modal";
import { afterPaint } from "@/lib/after-paint";

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
  const canEdit = useCan()("catalogue:write");
  const existing = id ? store.catalogue.product(id) : null;
  if (!canEdit)
    return (
      <Screen>
        <TopBar title="Products" onBack={leave} />
        <Notice message="Ask the shop owner to add or change products." />
      </Screen>
    );
  if (id && !existing)
    return (
      <Screen>
        <TopBar
          title="Product not found"
          subtitle="Return to the catalogue and choose a product."
          onBack={leave}
        />
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
  const toast = useToast();
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
  // Photos the product already has: saved as they are, never copied or checked.
  const kept = [existing?.photo_uri, existing?.photo2_uri];

  // Photos taken in this form but never saved are deleted when it closes.
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  });
  useEffect(
    () => () => {
      for (const slot of PHOTO_SLOTS) discardStagedPhoto(latest.current[slot]);
    },
    [],
  );

  function setPhoto(slot: PhotoSlot, uri: string | null) {
    const previous = draft[slot];
    const other = slot === "photo" ? draft.photo2 : draft.photo;
    if (previous !== uri && previous !== other) discardStagedPhoto(previous);
    dispatch({ type: "set-photo", slot, uri });
  }

  /** Clears photos added here whose file is gone; returns what to tell the cashier. */
  function dropLostPhotos(): string | null {
    const lost = lostPhotoSlots(draft, kept, photoExists);
    if (!lost.length) return null;
    for (const slot of lost) dispatch({ type: "set-photo", slot, uri: null });
    return lostPhotoMessage(lost);
  }

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
    const lost = dropLostPhotos();
    if (lost) {
      setError(lost);
      return;
    }
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
    afterPaint(() => void commit(result.input));
  }

  async function commit(input: Parameters<typeof store.catalogue.saveProduct>[0]) {
    // Photos copied into app storage by this save, removed again if it fails.
    const copied: string[] = [];
    const keep = async (source: string | null | undefined) => {
      if (!source || kept.includes(source)) return source ?? null;
      const saved = await savePhoto(source);
      if (saved && saved !== source) copied.push(saved);
      return saved;
    };
    // A new photo is hashed now (how it is synced); a kept one keeps its hash. A failed
    // hash never blocks the save: reconcile hashes unhashed photos later.
    const hashOf = (uri: string | null) =>
      uri && copied.includes(uri)
        ? fileSha256(uri).catch(() => undefined)
        : Promise.resolve(undefined);
    let committed = false;
    try {
      // One after the other, so a failed second copy still finds the first in `copied`.
      const photo = await keep(input.photo_uri);
      const photo2 = await keep(input.photo2_uri);
      const [photoHash, photo2Hash] = await Promise.all([hashOf(photo), hashOf(photo2)]);
      store.catalogue.saveProduct(
        {
          ...input,
          photo_uri: photo,
          photo2_uri: photo2,
          photo_hash: photoHash,
          photo2_hash: photo2Hash,
        },
        existing?.id,
      );
      committed = true;
      // The staged originals are now copied into product storage.
      for (const slot of PHOTO_SLOTS) discardStagedPhoto(draft[slot]);
      // Another product (or a synced copy) may show the same file.
      for (const old of [existing?.photo_uri, existing?.photo2_uri])
        if (old && old !== photo && old !== photo2 && !store.catalogue.photoInUse(old))
          removePhoto(old);
      // New or changed photos are learnt in the background (VisionProvider).
      refresh();
      toast.success(
        existing ? "Changes saved" : `${input.name.trim()} added to catalogue`,
      );
      leave();
    } catch (cause) {
      if (!committed) copied.forEach(removePhoto);
      // A photo that vanished during the save is cleared, so the form can be fixed.
      const lost = committed ? null : dropLostPhotos();
      setError(lost ?? errorMessage(cause));
    } finally {
      // Keep the guard until navigation unmounts the successfully saved form.
      if (!committed) saving.current = false;
      setBusy(false);
    }
  }

  const scanIndex = draft.variants.findIndex((v) => v.key === scanKey);

  return (
    <KeyboardAvoidingView
      style={[ui.flex, { backgroundColor: c.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen>
        <TopBar
          title={existing ? "Edit product" : "New product"}
          subtitle={
            existing ? existing.name : "Photos, name, and each size you sell."
          }
          onBack={leave}
          disabled={busy}
        />
        {!!error && <Notice message={error} error />}

        <PhotoField
          photos={{ photo: draft.photo, photo2: draft.photo2 }}
          disabled={busy}
          onChange={setPhoto}
          onError={setError}
        />

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
            contentContainerStyle={[ui.row, { gap: 8 }]}
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

        <View style={{ marginTop: 8 }}>
          <Text style={[ui.sectionTitle, { color: c.text }]}>
            Sizes and prices
          </Text>
          <Text style={[ui.caption, { color: c.muted }]}>
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
          icon="add"
          variant="ghost"
          disabled={busy}
          onPress={() => dispatch({ type: "add-variant", key: randomUUID() })}
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
