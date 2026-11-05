import { forwardRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { font, ui, usePalette } from "@/components/shop-ui";
import { COUNTRY_CODE, formatPhone, phoneDigits } from "@/domain/phone";

/**
 * A Lesotho phone number: a fixed +266 and 8 digits, grouped as "5812 3456". A pasted
 * "+266 5812 3456" is cleaned up rather than cut short (no maxLength; phoneDigits caps it).
 */
export const PhoneField = forwardRef<
  TextInput,
  {
    value: string;
    onChange: (digits: string) => void;
    onSubmit?: () => void;
    error?: string;
    editable?: boolean;
  }
>(function PhoneField({ value, onChange, onSubmit, error, editable = true }, ref) {
  const c = usePalette();
  const [focused, setFocused] = useState(false);
  const border = error ? c.danger : focused ? c.accent : c.subtle;
  return (
    <View style={ui.field}>
      <Text style={[ui.fieldLabel, { color: c.muted }]}>Phone number</Text>
      <View style={[styles.frame, { backgroundColor: c.subtle, borderColor: border }]}>
        <Text style={[styles.prefix, { color: c.text, borderRightColor: c.border }]}>
          +{COUNTRY_CODE}
        </Text>
        <TextInput
          ref={ref}
          accessibilityLabel="Phone number"
          accessibilityHint={error}
          value={formatPhone(value)}
          onChangeText={(text) => onChange(phoneDigits(text))}
          onSubmitEditing={onSubmit}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="5812 3456"
          placeholderTextColor={c.faint}
          selectionColor={c.accent}
          keyboardType="phone-pad"
          autoComplete="tel-national"
          textContentType="telephoneNumber"
          returnKeyType="next"
          editable={editable}
          style={[styles.input, { color: c.text }]}
        />
      </View>
      {!!error && <Text style={[ui.caption, { color: c.danger }]}>{error}</Text>}
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 52,
  },
  prefix: {
    ...font.medium,
    fontSize: 16,
    paddingHorizontal: 14,
    borderRightWidth: 1,
  },
  input: {
    ...font.medium,
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    letterSpacing: 0.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
