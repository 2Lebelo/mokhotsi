import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { loadImage } from "react-native-nitro-image";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Sheet } from "@/components/sheet";
import { Button, font, ui, usePalette } from "@/components/shop-ui";
import {
  hasRoomForPhoto,
  PHOTO_MESSAGES,
  photoProblem,
  squarePhoto,
} from "@/features/photos";
import { PhotoCapture } from "@/features/products/components/photo-capture";
import type { PhotoSlot } from "@/features/products/product-form";
import { toFilePath } from "@/features/vision/crops";
import { disposeImages } from "@/features/vision/still-pipeline";

const SLOTS: { slot: PhotoSlot; label: string }[] = [
  { slot: "photo", label: "Front" },
  { slot: "photo2", label: "Another angle" },
];

/**
 * One or two product photos. They are the product's thumbnail and, after saving,
 * are learnt in the background so the till camera can recognise the product.
 */
export function PhotoField({
  photos,
  disabled,
  onChange,
  onError,
}: {
  photos: Record<PhotoSlot, string | null>;
  disabled: boolean;
  onChange: (slot: PhotoSlot, uri: string | null) => void;
  onError: (message: string) => void;
}) {
  const c = usePalette();
  const [choosingFor, setChoosingFor] = useState<PhotoSlot | null>(null);
  const [capturingFor, setCapturingFor] = useState<PhotoSlot | null>(null);
  const [picking, setPicking] = useState<PhotoSlot | null>(null);
  const locked = disabled || picking !== null;

  // Photos are taken in the app (PhotoCapture). The library still opens the system picker,
  // which can only be reached by leaving the app.
  /** Says so before the camera or library opens, not after the cashier has framed a shot. */
  function roomForPhoto(): boolean {
    if (hasRoomForPhoto()) return true;
    onError(PHOTO_MESSAGES.storageFull);
    return false;
  }

  async function pickFromLibrary(slot: PhotoSlot) {
    setChoosingFor(null);
    if (!roomForPhoto()) return;
    setPicking(slot);
    try {
      // iOS cannot present the picker while the choice sheet is still closing.
      if (Platform.OS === "ios")
        await new Promise((resolve) => setTimeout(resolve, 350));
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1, // Re-encoded below, once.
        allowsEditing: true,
        aspect: [1, 1],
      });
      const asset = result.canceled ? null : result.assets[0];
      if (!asset) return;
      const image = await loadImage({ filePath: toFilePath(asset.uri) });
      try {
        onChange(slot, await squarePhoto(image));
      } finally {
        disposeImages(image);
      }
    } catch (cause) {
      onError(
        photoProblem(cause, "That photo could not be opened. Please choose another."),
      );
    } finally {
      setPicking(null);
    }
  }

  function takePhoto(slot: PhotoSlot) {
    setChoosingFor(null);
    if (roomForPhoto()) setCapturingFor(slot);
  }

  return (
    <View style={ui.field}>
      <Text style={[ui.fieldLabel, { color: c.muted }]}>Photos</Text>
      <View style={styles.tiles}>
        {SLOTS.map(({ slot, label }) => {
          const uri = photos[slot];
          return (
            <View key={slot} style={styles.tileSlot}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  uri ? `${label} photo. Replace photo` : `Add ${label} photo`
                }
                disabled={locked}
                onPress={() => setChoosingFor(slot)}
                style={({ pressed }) => [
                  styles.tile,
                  {
                    backgroundColor: c.subtle,
                    borderColor: uri ? c.border : c.subtle,
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                {uri ? (
                  <Image
                    source={{ uri }}
                    accessibilityLabel={`${label} photo`}
                    contentFit="cover"
                    transition={150}
                    style={StyleSheet.absoluteFill}
                  />
                ) : (
                  <View style={styles.placeholder}>
                    <Ionicons name="camera-outline" size={24} color={c.muted} />
                    <Text style={[styles.tileLabel, { color: c.muted }]}>
                      {label}
                    </Text>
                  </View>
                )}
                {picking === slot && (
                  <View style={[StyleSheet.absoluteFill, styles.busy]}>
                    <ActivityIndicator color={c.accent} />
                  </View>
                )}
              </Pressable>
              {uri && !locked && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${label} photo`}
                  hitSlop={8}
                  onPress={() => onChange(slot, null)}
                  style={[styles.remove, { backgroundColor: c.surface }]}
                >
                  <Ionicons name="close" size={16} color={c.text} />
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
      <Text style={[ui.caption, { color: c.muted }]}>
        Add 1–2 clear photos of the product on a plain background so the camera
        can recognise it at the till.
      </Text>

      <Sheet
        visible={choosingFor !== null}
        title={choosingFor === "photo2" ? "Another angle" : "Product photo"}
        onClose={() => setChoosingFor(null)}
      >
        <Button
          title="Take photo"
          icon="camera-outline"
          onPress={() => choosingFor && takePhoto(choosingFor)}
        />
        <Button
          title="Choose from library"
          icon="images-outline"
          secondary
          onPress={() => choosingFor && void pickFromLibrary(choosingFor)}
        />
      </Sheet>

      <PhotoCapture
        visible={capturingFor !== null}
        title={capturingFor === "photo2" ? "Another angle" : "Product photo"}
        onCapture={(uri) => {
          if (capturingFor) onChange(capturingFor, uri);
          setCapturingFor(null);
        }}
        onClose={() => setCapturingFor(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: 12 },
  tileSlot: { flex: 1, maxWidth: 180 },
  tile: {
    aspectRatio: 1,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  tileLabel: { ...font.medium, fontSize: 13 },
  busy: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  remove: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
    shadowColor: "#0F1419",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
});
