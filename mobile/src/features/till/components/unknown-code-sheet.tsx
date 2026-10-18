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
  onRegister: (code: string) => void;
  onClose: () => void;
}) {
  const c = usePalette();
  return (
    <Sheet
      visible={code !== null}
      title="Not in your catalogue"
      subtitle="Register it once and it will scan straight into the cart from now on."
      onClose={onClose}
    >
      <Text
        selectable
        style={[ui.sectionTitle, { color: c.text, letterSpacing: 1 }]}
      >
        {code}
      </Text>
      <Button
        title="Register product"
        onPress={() => code !== null && onRegister(code)}
      />
      <Button title="Keep scanning" secondary onPress={onClose} />
    </Sheet>
  );
}
