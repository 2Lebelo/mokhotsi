import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Sheet } from "@/components/sheet";
import { Chip, ui, usePalette } from "@/components/shop-ui";
import { DIMENSIONS, unitByCode, unitsByDimension } from "@/domain/units";

export function UnitPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (code: string) => void;
}) {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  const unit = unitByCode(value);
  return (
    <View style={ui.field}>
      <Text style={[ui.fieldLabel, { color: c.text }]}>Unit</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Unit, ${unit?.label ?? value}. Change unit`}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[
          ui.input,
          ui.spread,
          { backgroundColor: c.surface, borderColor: c.border },
        ]}
      >
        <Text style={[ui.body, { color: c.text }]}>
          {unit ? `${unit.label} (${unit.symbol})` : value}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={20} color={c.muted} />
      </Pressable>
      <Sheet
        visible={open}
        title="Choose a unit"
        subtitle="How this size is measured or packed."
        onClose={() => setOpen(false)}
      >
        <ScrollView contentContainerStyle={ui.stack}>
          {DIMENSIONS.map(({ dimension, label }) => (
            <View key={dimension} style={ui.stack}>
              <Text style={[ui.fieldLabel, { color: c.muted }]}>{label}</Text>
              <View style={ui.wrap}>
                {unitsByDimension(dimension).map((option) => (
                  <Chip
                    key={option.code}
                    label={`${option.label} (${option.symbol})`}
                    selected={option.code === value}
                    onPress={() => {
                      onChange(option.code);
                      setOpen(false);
                    }}
                  />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </Sheet>
    </View>
  );
}
