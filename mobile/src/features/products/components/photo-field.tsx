import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Image, View } from "react-native";

import { Button, Card, errorMessage, ui } from "@/components/shop-ui";

export function PhotoField({
  uri,
  disabled,
  onChange,
  onError,
}: {
  uri: string | null;
  disabled: boolean;
  onChange: (uri: string | null) => void;
  onError: (message: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const locked = disabled || picking;

  async function choose(camera: boolean) {
    setPicking(true);
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
      if (!result.canceled && result.assets[0]) onChange(result.assets[0].uri);
    } catch (cause) {
      onError(errorMessage(cause));
    } finally {
      setPicking(false);
    }
  }

  return (
    <Card>
      {uri && (
        <Image
          source={{ uri }}
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
            disabled={locked}
            onPress={() => void choose(false)}
          />
        </View>
        <View style={ui.grow}>
          <Button
            title="Take photo"
            secondary
            disabled={locked}
            onPress={() => void choose(true)}
          />
        </View>
      </View>
      {uri && (
        <Button
          title="Remove photo"
          secondary
          disabled={locked}
          onPress={() => onChange(null)}
        />
      )}
    </Card>
  );
}
