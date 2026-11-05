import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { ApiError } from "@/api/client";
import { unlinkDevice } from "@/api/endpoints";
import { useDevice } from "@/auth/device-provider";
import { useSession } from "@/auth/session-provider";
import { Sheet } from "@/components/sheet";
import { Button, errorMessage, Notice, ui, usePalette } from "@/components/shop-ui";
import { useToast } from "@/components/toast";
import { GoOnline } from "@/features/account/go-online";
import {
  checkSync,
  shopsToLeave,
  syncCheckText,
  type SyncCheck,
} from "@/features/account/sign-out";
import { useSync } from "@/features/sync/sync-provider";

/**
 * "Sign this phone out", for an owner: the phone first sends what it has, then leaves every
 * shop the owner manages and returns to sign-in. Each shop's data stays on the phone (locked),
 * so setting it up again for the shop carries on where it stopped, nothing downloaded twice.
 */
export function SignOutPhoneSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = usePalette();
  const toast = useToast();
  const { api, device, hasSession, refreshRoster, signOut } = useDevice();
  const { till, lock } = useSession();
  const { flush } = useSync();
  const [check, setCheck] = useState<SyncCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const userId = till.kind === "open" ? till.member.userId : null;
  const leaving = userId
    ? shopsToLeave(device.shops(), (shop, user) => device.member(shop, user), userId)
    : [];
  const leavingKey = leaving.map((shop) => shop.id).join(",");

  // Each time the sheet opens it starts afresh (state adjusted during render, not in an effect)…
  const [shown, setShown] = useState(visible);
  if (shown !== visible) {
    setShown(visible);
    if (visible) {
      setCheck(null);
      setError("");
    }
  }
  // … sends what this phone has, then says what is left.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void flush().then((result) => {
      if (!cancelled) setCheck(checkSync(result, leavingKey.split(",").filter(Boolean)));
    });
    return () => {
      cancelled = true;
    };
  }, [visible, flush, leavingKey]);

  const signOutPhone = async () => {
    const deviceId = device.deviceId();
    if (!api || !deviceId) return;
    setBusy(true);
    setError("");
    try {
      for (const shop of leaving)
        await unlinkDevice(api, shop.id, deviceId).catch((cause: unknown) => {
          // Already removed (another try, or by the admin): that is the goal.
          if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
        });
      device.markSignedOut();
      const names = leaving.map((shop) => shop.name).join(", ");
      onClose();
      // The roster drops these shops, which closes the till: with no shop left the phone
      // shows sign-in, otherwise the PIN pad of the shops other owners still have here.
      await refreshRoster();
      lock();
      await signOut();
      toast.success(`Signed out of ${names}`);
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  const online = !!api && hasSession;
  const ready = check !== null;
  return (
    <Sheet
      visible={visible}
      title="Sign this phone out?"
      subtitle={
        leaving.length
          ? `It stops serving ${leaving.map((shop) => shop.name).join(", ")} and opens on sign-in. Its data stays on it.`
          : undefined
      }
      onClose={busy ? () => {} : onClose}
    >
      <View style={ui.stack}>
        {!ready ? (
          <View style={[ui.row, { gap: 10, paddingVertical: 6 }]}>
            <ActivityIndicator size="small" color={c.accent} />
            <Text style={[ui.body, { color: c.muted }]}>Sending this phone&apos;s changes…</Text>
          </View>
        ) : (
          <Notice message={syncCheckText(check)} />
        )}
        {!online && (
          <GoOnline reason="Signing this phone out needs the internet. Confirm your PIN to connect." />
        )}
        {!!error && <Notice message={error} error />}
        <Button
          title={ready && check.kind === "waiting" ? "Sign out anyway" : "Sign out"}
          variant="danger"
          icon="log-out-outline"
          busy={busy}
          disabled={!ready || !online || !leaving.length}
          onPress={() => void signOutPhone()}
        />
        <Button title="Cancel" variant="secondary" disabled={busy} onPress={onClose} />
      </View>
    </Sheet>
  );
}
