import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Sheet } from "@/components/sheet";
import {
  Button,
  errorMessage,
  font,
  ui,
  usePalette,
} from "@/components/shop-ui";
import type { PhotoSlot } from "@/features/products/product-form";

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
  const [picking, setPicking] = useState<PhotoSlot | null>(null);
  const locked = disabled || picking !== null;

  async function pick(slot: PhotoSlot, camera: boolean) {
    setChoosingFor(null);
    setPicking(slot);
    try {
      // iOS cannot present the picker while the choice sheet is still closing.
      if (Platform.OS === "ios")
        await new Promise((resolve) => setTimeout(resolve, 350));
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted)
          throw new Error(
            "Allow camera access in your phone settings, or choose a photo from your library.",
          );
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
      };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled && result.assets[0])
        onChange(slot, result.assets[0].uri);
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setPicking(null);
    }
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
          onPress={() => choosingFor && void pick(choosingFor, true)}
        />
        <Button
          title="Choose from library"
          icon="images-outline"
          secondary
          onPress={() => choosingFor && void pick(choosingFor, false)}
        />
      </Sheet>
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
