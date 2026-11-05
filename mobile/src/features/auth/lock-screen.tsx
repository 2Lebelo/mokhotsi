import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { useDevice } from "@/auth/device-provider";
import type { PinMatch } from "@/auth/pin-match";
import { useSession } from "@/auth/session-provider";
import { Sheet } from "@/components/sheet";
import { Divider, font, Notice, Screen, ui, usePalette } from "@/components/shop-ui";
import { feedback } from "@/features/feedback";
import { AuthLink } from "@/features/auth/components/auth-layout";
import { PinDots, PinPad } from "@/features/auth/pin-pad";

function formatWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.ceil(seconds / 60)} min`;
}

/**
 * The PIN pad a phone with shops opens on. There is no list of names: the PIN alone says who
 * it is, checked offline against the roster.
 */
export function LockScreen() {
  const c = usePalette();
  const { device } = useDevice();
  const { unlock, choose, startSignIn } = useSession();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // A lockout survives the app closing: read it once, when the pad first shows.
  const [lockedUntil, setLockedUntil] = useState<number | null>(
    () => device.lockout().lockedUntil,
  );
  const [now, setNow] = useState(() => Date.now());
  const [choices, setChoices] = useState<PinMatch[]>([]);

  const shops = device.shops();
  const title = shops.length === 1 ? shops[0].name : "Mokhotsi";
  const waiting = lockedUntil !== null && lockedUntil > now;

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const submit = async (value: string) => {
    setBusy(true);
    try {
      const result = await unlock(value);
      setPin("");
      if (result.kind === "open") return;
      if (result.kind === "choose") {
        setMessage("");
        setChoices(result.matches);
        return;
      }
      feedback.error();
      if (result.lockedForMs > 0) {
        setLockedUntil(Date.now() + result.lockedForMs);
        setNow(Date.now());
        setMessage("Too many wrong PINs.");
      } else setMessage("That PIN is not right. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll={false}>
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={[styles.badge, { backgroundColor: c.tint }]}>
            <Ionicons name="lock-closed" size={22} color={c.accent} />
          </View>
          <Text accessibilityRole="header" style={[ui.title, { color: c.text, textAlign: "center" }]}>
            {title}
          </Text>
          <Text style={[ui.body, { color: c.muted, textAlign: "center" }]}>
            Enter your PIN
          </Text>
        </View>
        <PinDots length={pin.length} error={!!message && !pin} />
        <View style={styles.message}>
          {busy ? (
            <View style={[ui.row, { justifyContent: "center", gap: 8 }]}>
              <ActivityIndicator size="small" color={c.accent} />
              <Text style={[ui.caption, { color: c.muted }]}>Unlocking…</Text>
            </View>
          ) : waiting ? (
            <Notice message={`Too many wrong PINs. Try again in ${formatWait(lockedUntil - now)}.`} error />
          ) : (
            !!message && <Notice message={message} error />
          )}
        </View>
        <PinPad
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (value) setMessage("");
          }}
          onComplete={(value) => void submit(value)}
          disabled={busy || waiting}
        />
        <View style={styles.footer}>
          <Text style={[ui.caption, { color: c.muted, textAlign: "center" }]}>
            Forgot your PIN? Ask the shop owner to set a new one.
          </Text>
          <AuthLink
            prompt="Owner or admin?"
            action="Sign in with phone number"
            onPress={startSignIn}
          />
        </View>
      </View>

      <Sheet
        visible={choices.length > 0}
        title="Choose a shop"
        subtitle="Your PIN opens more than one shop on this phone."
        onClose={() => setChoices([])}
      >
        {choices.map((match, i) => (
          <View key={match.shop.id}>
            {i > 0 && <Divider />}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${match.shop.name}`}
              onPress={() => {
                setChoices([]);
                choose(match);
              }}
              style={({ pressed }) => [ui.row, styles.choice, { opacity: pressed ? 0.6 : 1 }]}
            >
              <View style={[styles.icon, { backgroundColor: c.subtle }]}>
                <Ionicons name="storefront-outline" size={18} color={c.text} />
              </View>
              <View style={ui.grow}>
                <Text style={[ui.body, font.medium, { color: c.text }]}>{match.shop.name}</Text>
                {match.shop.status === "suspended" && (
                  <Text style={[ui.caption, { color: c.danger }]}>Suspended</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.faint} />
            </Pressable>
          </View>
        ))}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center", gap: 20 },
  header: { alignItems: "center", gap: 6 },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  message: { minHeight: 48, justifyContent: "center" },
  footer: { gap: 10 },
  choice: { minHeight: 60, paddingVertical: 10 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
