import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { LoadingScreen } from "@/components/loading";
import {
  Button,
  Notice,
  Screen,
  TopBar,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useShop } from "@/db/ShopProvider";
import { ProductSearchSheet } from "@/features/till/components/product-search-sheet";
import { VariantPickerSheet } from "@/features/till/components/variant-picker-sheet";
import {
  MatchesSheet,
  toMatches,
} from "@/features/vision/components/matches-sheet";
import { VisionDebug } from "@/features/vision/components/vision-debug";
import { MANIFEST, PIPELINE } from "@/features/vision/config";
import type { IdentifyState } from "@/features/vision/identify-reducer";
import { useIdentify } from "@/features/vision/use-identify";
import { useVisionSession } from "@/features/vision/use-vision-session";
import {
  cameraModeFor,
  VisionCameraView,
} from "@/features/vision/vision-camera-view";
import type { VisionModels } from "@/features/vision/vision-service";

/** Identify an item without a barcode, from the Till's "Non-barcode" button. */
export default function IdentifyScreen() {
  const session = useVisionSession();
  if (session.state === "ready") return <Identify models={session.models} />;
  if (session.state === "loading")
    return <LoadingScreen message="Getting the camera ready…" />;
  return (
    <Screen>
      <TopBar
        title="Identify item"
        subtitle="Visual identification isn't available right now."
        backIcon="close"
        backLabel="Back to the till"
        onBack={() => router.back()}
      />
      <Notice message={session.message} error />
      <Button title="Back to the till" onPress={() => router.back()} />
    </Screen>
  );
}

function statusText(state: IdentifyState, hint: boolean): string {
  if (hint)
    return "Move closer, fill the frame with the item, and use good light.";
  if (!state.detection?.box) return "Point the camera at the item.";
  return state.detection.stable ? "Matching…" : "Hold it still…";
}

function Identify({ models }: { models: VisionModels }) {
  const c = usePalette();
  const { store } = useShop();
  const identify = useIdentify();
  const { state } = identify;
  const [mode] = useState(() => cameraModeFor());
  const [hint, setHint] = useState(false);

  // After a while without a confident match, offer guidance and the closest matches.
  useEffect(() => {
    if (!identify.processing) return;
    const timer = setTimeout(() => setHint(true), PIPELINE.hintAfterMs);
    return () => {
      clearTimeout(timer);
      setHint(false);
    };
  }, [identify.processing]);

  const sizing =
    state.sheet.kind === "size"
      ? store.catalogue.product(state.sheet.productId)
      : null;

  return (
    <Screen>
      <TopBar
        title="Identify item"
        subtitle="For items without a barcode"
        backIcon="close"
        backLabel="Close"
        onBack={() => router.back()}
      />

      {identify.knownViews === 0 && (
        <Notice message="No products have photos yet. Add photos to products in the catalogue, or search for this item." />
      )}
      {!!state.error && <Notice message={state.error} error />}

      <VisionCameraView
        models={models}
        mode={mode}
        active={identify.processing}
        identifying={identify.identifying}
        onView={(view) => identify.onView(view, { single: mode === "still" })}
        onDetection={identify.onDetection}
        onError={identify.onError}
        captureLabel="Identify"
      />
      {mode === "live" && (
        <Text style={[ui.body, { color: c.muted, textAlign: "center" }]}>
          {statusText(state, hint)}
        </Text>
      )}
      <VisionDebug
        mode={mode}
        accelerator={models.accelerator}
        detection={state.detection}
        view={state.view}
        ranking={state.ranking}
      />

      <View style={ui.row}>
        <View style={ui.grow}>
          <Button
            title="Search instead"
            icon="search"
            secondary
            onPress={identify.search}
          />
        </View>
        {hint && state.ranking.length > 0 && (
          <View style={ui.grow}>
            <Button
              title="Closest matches"
              secondary
              onPress={identify.showMatches}
            />
          </View>
        )}
      </View>

      <MatchesSheet
        visible={state.sheet.kind === "matches"}
        confident={state.sheet.kind === "matches" && state.sheet.confident}
        matches={toMatches(state.ranking, (id) => store.catalogue.product(id))}
        acceptThreshold={MANIFEST.matching.accept_threshold}
        onPick={identify.pick}
        onSearch={identify.search}
        onRetry={identify.retry}
      />
      <VariantPickerSheet
        product={sizing}
        onPick={identify.addToCart}
        onClose={identify.retry}
      />
      <ProductSearchSheet
        visible={state.sheet.kind === "search"}
        onPick={identify.pick}
        onClose={identify.retry}
      />
    </Screen>
  );
}
