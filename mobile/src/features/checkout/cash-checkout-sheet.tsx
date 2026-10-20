import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Sheet } from "@/components/sheet";
import {
  Button,
  Chip,
  Divider,
  font,
  Notice,
  ui,
  usePalette,
} from "@/components/shop-ui";
import {
  centsToTyped,
  pressKey,
  quickCash,
  tender,
  typedCents,
} from "@/domain/cash";
import { Keypad } from "@/features/checkout/keypad";
import { formatMoney } from "@/lib/money";

/**
 * Taking cash at the till: the cashier keys in what the customer handed over
 * and the change is shown, like a shop calculator. The sale is only recorded
 * once the cash covers the total.
 */
export function CashCheckoutSheet({
  visible,
  totalCents,
  itemCount,
  busy,
  error,
  onComplete,
  onClose,
}: {
  visible: boolean;
  totalCents: number;
  itemCount: number;
  busy: boolean;
  /** Why the last attempt failed, e.g. stock changed; shown inside the sheet. */
  error?: string;
  onComplete: (tenderedCents: number) => void;
  onClose: () => void;
}) {
  const c = usePalette();
  const [typed, setTyped] = useState("");
  const tendered = typedCents(typed);
  const status = tender(totalCents, tendered);

  function close() {
    if (busy) return;
    setTyped("");
    onClose();
  }

  return (
    <Sheet
      visible={visible}
      title="Cash payment"
      subtitle={`${itemCount} ${itemCount === 1 ? "item" : "items"}`}
      onClose={close}
    >
      <ScrollView
        contentContainerStyle={ui.stack}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!!error && <Notice message={error} error />}
        <View style={[styles.summary, { backgroundColor: c.subtle }]}>
          <View style={ui.spread}>
            <Text style={[ui.body, { color: c.muted }]}>Total due</Text>
            <Text style={[styles.total, ui.money, { color: c.text }]}>
              {formatMoney(totalCents)}
            </Text>
          </View>
          <Divider />
          <View style={ui.spread}>
            <Text style={[ui.body, { color: c.muted }]}>Cash received</Text>
            <Text
              accessibilityLiveRegion="polite"
              style={[
                styles.amount,
                ui.money,
                { color: tendered === null ? c.faint : c.text },
              ]}
            >
              {tendered === null ? "M 0.00" : `M ${typed || "0"}`}
            </Text>
          </View>
          <View style={ui.spread}>
            <Text style={[ui.body, { color: c.muted }]}>
              {status.status === "short" ? "Still to pay" : "Change"}
            </Text>
            <Text
              accessibilityLiveRegion="polite"
              style={[
                ui.money,
                styles.change,
                {
                  color:
                    status.status === "short"
                      ? c.danger
                      : status.status === "paid"
                        ? c.accent
                        : c.faint,
                },
              ]}
            >
              {status.status === "short"
                ? formatMoney(status.shortCents)
                : status.status === "paid"
                  ? formatMoney(status.changeCents)
                  : "—"}
            </Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[ui.row, { gap: 8 }]}
        >
          {quickCash(totalCents).map((amount) => (
            <Chip
              key={amount}
              label={amount === totalCents ? "Exact" : formatMoney(amount)}
              accessibilityLabel={
                amount === totalCents
                  ? `Exact amount, ${formatMoney(amount)}`
                  : `Customer paid ${formatMoney(amount)}`
              }
              selected={tendered === amount}
              onPress={() => setTyped(centsToTyped(amount))}
            />
          ))}
        </ScrollView>

        <Keypad
          disabled={busy}
          onKey={(key) => setTyped((current) => pressKey(current, key))}
          onClear={() => setTyped("")}
        />

        <Button
          title={
            status.status === "paid"
              ? `Complete sale · Change ${formatMoney(status.changeCents)}`
              : "Complete sale"
          }
          icon="checkmark"
          busy={busy}
          disabled={status.status !== "paid"}
          onPress={() => {
            if (tendered !== null) onComplete(tendered);
          }}
        />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  summary: { borderRadius: 16, padding: 16, gap: 12 },
  total: { fontSize: 22, letterSpacing: -0.3 },
  amount: { fontSize: 18 },
  change: { ...font.bold, fontSize: 22, letterSpacing: -0.3 },
});
