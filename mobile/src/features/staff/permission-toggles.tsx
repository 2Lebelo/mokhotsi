import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import { Divider, font, ui, usePalette } from "@/components/shop-ui";
import {
  CASHIER_GRANTABLE,
  GRANT_LABELS,
  SHOP_PERMISSIONS,
  type Permission,
} from "@/domain/permissions";

/** What an owner can let a cashier do beyond selling. Selling is always on. */
export function PermissionToggles({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly Permission[];
  onChange: (value: Permission[]) => void;
  disabled?: boolean;
}) {
  const c = usePalette();
  return (
    <View>
      {CASHIER_GRANTABLE.map((permission, i) => {
        const on = value.includes(permission);
        const toggle = () =>
          onChange(on ? value.filter((p) => p !== permission) : [...value, permission]);
        return (
          <View key={permission}>
            {i > 0 && <Divider />}
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: on, disabled }}
              accessibilityLabel={GRANT_LABELS[permission]}
              accessibilityHint={SHOP_PERMISSIONS[permission]}
              disabled={disabled}
              onPress={toggle}
              style={[ui.row, styles.row]}
            >
              <View style={ui.grow}>
                <Text style={[ui.body, font.medium, { color: c.text }]}>
                  {GRANT_LABELS[permission]}
                </Text>
                <Text style={[ui.caption, { color: c.muted }]}>{SHOP_PERMISSIONS[permission]}</Text>
              </View>
              <Switch
                value={on}
                onValueChange={toggle}
                disabled={disabled}
                trackColor={{ true: c.accent, false: c.border }}
                thumbColor={c.surface}
                importantForAccessibility="no"
              />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({ row: { paddingVertical: 10, minHeight: 56 } });
