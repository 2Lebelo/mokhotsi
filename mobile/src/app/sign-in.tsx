import { router } from "expo-router";
import { useRef, useState } from "react";
import { Text, type TextInput } from "react-native";

import { signInWithPin } from "@/api/endpoints";
import { useDevice } from "@/auth/device-provider";
import { useSession } from "@/auth/session-provider";
import { Button, Notice, ui, usePalette } from "@/components/shop-ui";
import { useToast } from "@/components/toast";
import { isPhoneComplete, toE164 } from "@/domain/phone";
import { isPinShaped } from "@/domain/pin";
import { deviceRef } from "@/features/account/phone";
import { AuthLayout, AuthLink } from "@/features/auth/components/auth-layout";
import { PhoneField } from "@/features/auth/components/phone-field";
import { PinCells } from "@/features/auth/components/pin-cells";
import { authErrorMessage, retryAt } from "@/features/auth/messages";
import { feedback } from "@/features/feedback";
import { useCountdown } from "@/hooks/use-countdown";
import { useOnline } from "@/hooks/use-online";

/**
 * Where a phone that isn't set up for a shop opens: an owner (or the admin) signs in with
 * their phone number and PIN. Afterwards the phone opens on the PIN pad, for everyone.
 *
 * Also reached from a shop phone's PIN pad ("Sign in with phone number"): there the session
 * lives in memory only, so it never stays signed in on a till, and back returns to the pad.
 */
export default function SignInScreen() {
  const c = usePalette();
  const toast = useToast();
  const online = useOnline();
  const { api, device, secrets, adoptSignIn } = useDevice();
  const { cancelSignIn } = useSession();
  const shopPhone = device.hasShops();
  const pinInput = useRef<TextInput>(null);
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const wait = useCountdown(waitUntil);
  const removed = device.wasRemoved();
  const signedOut = device.wasSignedOut();

  const submit = async (value: string) => {
    if (!api || busy || !online || wait > 0) return;
    if (!isPhoneComplete(phone)) {
      setError("Enter your 8-digit phone number.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Never retried: a second attempt could register the phone twice or count twice.
      const tokens = await signInWithPin(api, toE164(phone), value, await deviceRef(secrets, device));
      await adoptSignIn(tokens, { remember: !shopPhone });
      feedback.success();
      toast.success(`Welcome, ${tokens.user.name.split(" ")[0]}`);
    } catch (cause) {
      setPin("");
      setShake((n) => n + 1);
      feedback.error();
      setWaitUntil(retryAt(cause, Date.now()));
      setError(authErrorMessage(cause));
      pinInput.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={shopPhone ? "Sign in" : "Welcome back"}
      subtitle={
        shopPhone
          ? "Owners and the admin sign in with their phone number and PIN."
          : "Sign in with your phone number and PIN."
      }
      onBack={shopPhone ? cancelSignIn : undefined}
      backLabel="Back to the PIN pad"
      footer={
        shopPhone ? (
          <Text style={[ui.caption, { color: c.muted, textAlign: "center" }]}>
            Cashier? Go back and enter your PIN.
          </Text>
        ) : (
          <>
            <AuthLink
              prompt="New to Mokhotsi?"
              action="Create an account"
              onPress={() => router.push("/sign-up")}
            />
            <Text style={[ui.caption, { color: c.muted, textAlign: "center" }]}>
              Cashier? Ask your shop owner to set up this phone, then sign in with your PIN.
            </Text>
          </>
        )
      }
    >
      {signedOut ? (
        <Notice message="You signed this phone out. Its shop data is kept: sign in to set it up again." />
      ) : (
        removed && (
          <Notice message="This phone was removed from its shop. Its data is kept. The owner can sign in to set it up again." />
        )
      )}
      <PhoneField
        value={phone}
        onChange={(digits) => {
          setPhone(digits);
          setError("");
          if (isPhoneComplete(digits)) pinInput.current?.focus();
        }}
        onSubmit={() => pinInput.current?.focus()}
        editable={!busy}
      />
      <PinCells
        ref={pinInput}
        label="PIN"
        value={pin}
        onChange={(value) => {
          setPin(value);
          if (value) setError("");
        }}
        onComplete={(value) => void submit(value)}
        shakeKey={shake}
        editable={!busy}
      />
      {!!error && (
        <Notice message={wait > 0 ? `${error} Try again in ${wait} s.` : error} error />
      )}
      <Button
        title={busy ? "Signing in…" : "Sign in"}
        busy={busy}
        disabled={!api || !online || wait > 0 || !isPhoneComplete(phone) || !isPinShaped(pin)}
        onPress={() => void submit(pin)}
      />
    </AuthLayout>
  );
}
