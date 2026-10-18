import { Text, View } from "react-native";

import { Button, Card, Field, ui, usePalette } from "@/components/shop-ui";
import { formatVariantLabel, isCountUnit, parseSize } from "@/domain/units";
import type {
  VariantDraft,
  VariantField,
} from "@/features/products/product-form";
import { UnitPicker } from "@/features/products/components/unit-picker";

function previewLabel(variant: VariantDraft): string | null {
  try {
    return formatVariantLabel(
      parseSize(variant.size, variant.unit),
      variant.unit,
    );
  } catch {
    return null;
  }
}

/** One size of a product: amount and unit, price, stock, and barcode. */
export function VariantEditor({
  index,
  variant,
  errors = {},
  disabled,
  canRemove,
  onChange,
  onRemove,
  onScan,
}: {
  index: number;
  variant: VariantDraft;
  errors?: Partial<Record<VariantField, string>>;
  disabled: boolean;
  canRemove: boolean;
  onChange: (field: VariantField, value: string) => void;
  onRemove: () => void;
  onScan: () => void;
}) {
  const c = usePalette();
  const label = previewLabel(variant);
  const counted = isCountUnit(variant.unit);
  return (
    <Card>
      <View style={ui.spread}>
        <View style={ui.grow}>
          <Text style={[ui.caption, { color: c.muted }]}>SIZE {index + 1}</Text>
          <Text style={[ui.sectionTitle, { color: c.text }]}>
            {label ?? "New size"}
          </Text>
        </View>
        {canRemove && (
          <Button
            title="Remove"
            secondary
            disabled={disabled}
            accessibilityLabel={`Remove size ${index + 1}`}
            onPress={onRemove}
          />
        )}
      </View>
      <View style={[ui.row, { alignItems: "flex-start" }]}>
        <View style={ui.grow}>
          <Field
            label={counted ? "Items per unit" : "Size"}
            placeholder={counted ? "e.g. 6" : "e.g. 500"}
            keyboardType={counted ? "number-pad" : "decimal-pad"}
            value={variant.size}
            onChangeText={(value) => onChange("size", value)}
            maxLength={16}
            editable={!disabled}
            error={errors.size}
          />
        </View>
        <View style={ui.grow}>
          <UnitPicker
            value={variant.unit}
            disabled={disabled}
            onChange={(value) => onChange("unit", value)}
          />
        </View>
      </View>
      <View style={[ui.row, { alignItems: "flex-start" }]}>
        <View style={ui.grow}>
          <Field
            label="Price (LSL)"
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={variant.price}
            onChangeText={(value) => onChange("price", value)}
            maxLength={18}
            editable={!disabled}
            error={errors.price}
          />
        </View>
        <View style={ui.grow}>
          <Field
            label="Stock"
            placeholder="0"
            keyboardType="number-pad"
            value={variant.stock}
            onChangeText={(value) => onChange("stock", value)}
            maxLength={16}
            editable={!disabled}
            error={errors.stock}
          />
        </View>
      </View>
      <Field
        label="Barcode (optional)"
        placeholder="Scan or type"
        value={variant.barcode}
        onChangeText={(value) => onChange("barcode", value)}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={64}
        editable={!disabled}
        error={errors.barcode}
        accessory={
          <Button
            title="Scan"
            secondary
            disabled={disabled}
            accessibilityLabel={`Scan barcode for size ${index + 1}`}
            onPress={onScan}
          />
        }
      />
    </Card>
  );
}
