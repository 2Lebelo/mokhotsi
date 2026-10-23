import { randomUUID } from "expo-crypto";
import { useRef, useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";

import { Sheet } from "@/components/sheet";
import {
  Button,
  Chip,
  Divider,
  errorMessage,
  Field,
  font,
  Notice,
  Stepper,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useToast } from "@/components/toast";
import type { Sale, SaleItem } from "@/db/store";
import { useShop } from "@/db/ShopProvider";
import { feedback } from "@/features/feedback";
import { formatMoney } from "@/lib/money";

const REASONS = [
  "Customer return",
  "Wrong item",
  "Cashier mistake",
  "Damaged or expired",
] as const;
const OTHER = "Other";
const DAMAGED = "Damaged or expired";

type Line = { quantity: number; restock: boolean };

/**
 * Refunds some or all of today's sale in cash. Every line starts with all of
 * its remaining units and goes back to stock unless the cashier says it is
 * damaged. Mount it only while open, so each opening starts fresh and gets its
 * own reversal reference (a double tap can never refund twice).
 */
export function ReverseSaleSheet({
  sale,
  items,
  onClose,
}: {
  sale: Sale;
  items: SaleItem[];
  onClose: () => void;
}) {
  const c = usePalette();
  const { store, refresh } = useShop();
  const toast = useToast();
  const reversalId = useRef(randomUUID()).current;
  const open = items.filter((item) => item.quantity > item.reversed_quantity);
  const [lines, setLines] = useState<Record<string, Line>>(() =>
    Object.fromEntries(
      open.map((item) => [
        item.id,
        {
          quantity: item.quantity - item.reversed_quantity,
          restock: !!item.variant_active,
        },
      ]),
    ),
  );
  const [reason, setReason] = useState<string | null>(null);
  const [otherReason, setOtherReason] = useState("");
  const [error, setError] = useState("");

  const refund = open.reduce(
    (sum, item) =>
      sum + item.unit_price_cents * (lines[item.id]?.quantity ?? 0),
    0,
  );
  const units = open.reduce(
    (sum, item) => sum + (lines[item.id]?.quantity ?? 0),
    0,
  );
  const why = reason === OTHER ? otherReason.trim() : (reason ?? "");

  function update(id: string, change: Partial<Line>) {
    setError("");
    setLines((current) => ({
      ...current,
      [id]: { ...current[id], ...change },
    }));
  }

  function chooseReason(next: string) {
    setError("");
    setReason(next);
    // Damaged goods cannot be sold again, so they are written off by default.
    if (next === DAMAGED)
      setLines((current) =>
        Object.fromEntries(
          Object.entries(current).map(([id, line]) => [
            id,
            { ...line, restock: false },
          ]),
        ),
      );
  }

  function confirm() {
    try {
      store.sales.reverse(
        reversalId,
        sale.id,
        open.map((item) => ({
          saleItemId: item.id,
          quantity: lines[item.id].quantity,
          restock: lines[item.id].restock,
        })),
        why,
      );
      refresh();
      toast.success(`Refunded ${formatMoney(refund)} · give the cash back`);
      onClose();
    } catch (cause) {
      feedback.error();
      setError(errorMessage(cause));
    }
  }

  return (
    <Sheet
      visible
      title="Reverse sale"
      subtitle={`#${sale.id.slice(0, 8).toUpperCase()} · choose what came back`}
      onClose={onClose}
    >
      <ScrollView
        contentContainerStyle={ui.stack}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!!error && <Notice message={error} error />}

        {open.map((item, index) => {
          const line = lines[item.id];
          const left = item.quantity - item.reversed_quantity;
          const name = `${item.product_name} · ${item.variant_label}`;
          return (
            <View key={item.id} style={ui.stack}>
              {index > 0 && <Divider />}
              <View style={ui.spread}>
                <View style={ui.grow}>
                  <Text style={[ui.body, font.medium, { color: c.text }]}>
                    {name}
                  </Text>
                  <Text style={[ui.caption, { color: c.muted }]}>
                    {formatMoney(item.unit_price_cents)} each · {left} can be
                    returned
                  </Text>
                </View>
                <Stepper
                  value={line.quantity}
                  name={name}
                  min={0}
                  max={left}
                  onChange={(quantity) => update(item.id, { quantity })}
                />
              </View>
              <View style={ui.spread}>
                <Text
                  style={[
                    ui.caption,
                    { color: item.variant_active ? c.muted : c.faint },
                  ]}
                >
                  {!item.variant_active
                    ? "No longer sold, so it can't go back to stock"
                    : line.restock
                      ? "Back to stock"
                      : "Write off (damaged, not resold)"}
                </Text>
                <Switch
                  accessibilityLabel={`Return ${name} to stock`}
                  value={line.restock}
                  disabled={!item.variant_active || line.quantity === 0}
                  onValueChange={(restock) => update(item.id, { restock })}
                  trackColor={{ true: c.accent, false: c.border }}
                  thumbColor={c.surface}
                />
              </View>
            </View>
          );
        })}

        <Divider />
        <Text style={[ui.fieldLabel, { color: c.muted }]}>Reason</Text>
        <View style={ui.wrap}>
          {[...REASONS, OTHER].map((label) => (
            <Chip
              key={label}
              label={label}
              selected={reason === label}
              onPress={() => chooseReason(label)}
            />
          ))}
        </View>
        {reason === OTHER && (
          <Field
            label="Describe the reason"
            placeholder="e.g. Customer changed their mind"
            value={otherReason}
            onChangeText={(value) => {
              setError("");
              setOtherReason(value);
            }}
            maxLength={120}
            autoFocus
          />
        )}

        <View style={[ui.spread, { paddingTop: 4 }]}>
          <Text style={[ui.body, { color: c.muted }]}>
            Cash to give back · {units} {units === 1 ? "item" : "items"}
          </Text>
          <Text style={[ui.money, { color: c.text, fontSize: 20 }]}>
            {formatMoney(refund)}
          </Text>
        </View>
        <Button
          title={units ? `Refund ${formatMoney(refund)}` : "Refund"}
          icon="return-down-back"
          variant="danger"
          disabled={!units || !why}
          onPress={confirm}
        />
        {!why && !!units && (
          <Text style={[ui.caption, { color: c.muted, textAlign: "center" }]}>
            Choose a reason to continue.
          </Text>
        )}
      </ScrollView>
    </Sheet>
  );
}
