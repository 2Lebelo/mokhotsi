import { Text } from "react-native";

import { Sheet } from "@/components/sheet";
import { Button, ui, usePalette } from "@/components/shop-ui";

export function UnknownCodeSheet({
  code,
  onRegister,
  onClose,
}: {
  /** The unknown barcode, or null when the sheet is hidden. */
  code: string | null;
  /** Omitted for someone who may not add products. */
  onRegister?: (code: string) => void;
  onClose: () => void;
}) {
  const c = usePalette();
  return (
    <Sheet
      visible={code !== null}
      title="Not in your catalogue"
      subtitle={
        onRegister
          ? "Register it once and it will scan straight into the cart from now on."
          : "Ask the shop owner to add this product."
      }
      onClose={onClose}
    >
      <Text
        selectable
        style={[
          ui.money,
          {
            color: c.text,
            fontSize: 18,
            letterSpacing: 1,
            backgroundColor: c.subtle,
            padding: 14,
            borderRadius: 12,
            textAlign: "center",
          },
        ]}
      >
        {code}
      </Text>
      {onRegister && (
        <Button
          title="Register product"
          icon="add"
          onPress={() => code !== null && onRegister(code)}
        />
      )}
      <Button title="Keep scanning" secondary onPress={onClose} />
    </Sheet>
  );
}
