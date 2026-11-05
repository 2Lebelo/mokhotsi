import { Ionicons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useDevice } from "@/auth/device-provider";
import { Button, Card, errorMessage, font, ui, usePalette } from "@/components/shop-ui";
import { useToast } from "@/components/toast";
import { formatPhone } from "@/domain/phone";
import { useApprovalPolling } from "@/features/onboarding/use-approval-polling";

/**
 * Registered, waiting for Mokhotsi. The screen checks by itself (backing off, see poll.ts)
 * and moves on to naming the shop the moment the owner is approved.
 */
export function WaitingStep() {
  const c = usePalette();
  const toast = useToast();
  const { account, refreshAccount } = useDevice();
  const [checking, setChecking] = useState(false);
  const check = useCallback(async () => {
    await refreshAccount();
  }, [refreshAccount]);
  useApprovalPolling(check);

  const local = account?.phone?.replace(/^\+266/, "") ?? "";
  return (
    <>
      <Card style={styles.card}>
        <View style={[styles.badge, { backgroundColor: c.tint }]}>
          <Ionicons name="hourglass-outline" size={26} color={c.accent} />
        </View>
        <Text style={[ui.sectionTitle, styles.center, { color: c.text }]}>
          We’re reviewing your registration
        </Text>
        <Text style={[ui.body, styles.center, { color: c.muted }]}>
          Mokhotsi will call you on{" "}
          <Text style={[font.semibold, { color: c.text }]}>+266 {formatPhone(local)}</Text> to
          confirm your business. This screen updates by itself once you’re approved.
        </Text>
        <View style={[ui.row, styles.status]}>
          <ActivityIndicator size="small" color={c.accent} />
          <Text style={[ui.caption, { color: c.muted }]}>Waiting for approval</Text>
        </View>
      </Card>
      <Button
        title="Check now"
        variant="secondary"
        icon="refresh"
        busy={checking}
        onPress={async () => {
          setChecking(true);
          try {
            const latest = await refreshAccount();
            // Approved: this screen is about to move on by itself.
            if (latest?.status === "pending") toast.info("Still waiting for approval");
          } catch (error) {
            toast.error(errorMessage(error));
          } finally {
            setChecking(false);
          }
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center", paddingVertical: 24, gap: 10 },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  center: { textAlign: "center" },
  status: { gap: 8, marginTop: 6 },
});
