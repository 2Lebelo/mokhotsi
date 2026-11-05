import { router } from "expo-router";
import { useRef, useState } from "react";
import type { TextInput } from "react-native";

import { register } from "@/api/endpoints";
import { useDevice } from "@/auth/device-provider";
import { Button, Field, Notice } from "@/components/shop-ui";
import { useToast } from "@/components/toast";
import { isPhoneComplete, toE164 } from "@/domain/phone";
import { PIN_LENGTH, pinProblem } from "@/domain/pin";
import { newDevice } from "@/features/account/phone";
import { AuthLayout, AuthLink } from "@/features/auth/components/auth-layout";
import { PhoneField } from "@/features/auth/components/phone-field";
import { PinCells } from "@/features/auth/components/pin-cells";
import { authErrorMessage, retryAt } from "@/features/auth/messages";
import { feedback } from "@/features/feedback";
import { useCountdown } from "@/hooks/use-countdown";
import { useOnline } from "@/hooks/use-online";

/** A shop owner signs up. Mokhotsi reviews every new owner before their shop opens. */
export default function SignUpScreen() {
  const toast = useToast();
  const online = useOnline();
  const { api, adoptSignIn } = useDevice();
  const phoneInput = useRef<TextInput>(null);
  const pinInput = useRef<TextInput>(null);
  const confirmInput = useRef<TextInput>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const wait = useCountdown(waitUntil);

  const pinError = pin.length === PIN_LENGTH ? pinProblem(pin) : null;
  const mismatch = confirm.length === PIN_LENGTH && confirm !== pin;
  const ready =
    !!api &&
    online &&
    wait === 0 &&
    !!name.trim() &&
    isPhoneComplete(phone) &&
    pin.length === PIN_LENGTH &&
    !pinError &&
    confirm === pin;

  const submit = async () => {
    if (!api || !ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const tokens = await register(api, {
        name: name.trim(),
        phone: toE164(phone),
        pin,
        device: newDevice(),
      });
      await adoptSignIn(tokens, { remember: true });
      feedback.success();
      toast.success("Registration sent");
    } catch (cause) {
      feedback.error();
      setWaitUntil(retryAt(cause, Date.now()));
      setError(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="For shop owners. We check every new business, usually with a quick call."
      footer={
        <AuthLink
          prompt="Already registered?"
          action="Sign in"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/sign-in"))}
        />
      }
    >
      <Field
        label="Your name"
        value={name}
        onChangeText={setName}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
        returnKeyType="next"
        onSubmitEditing={() => phoneInput.current?.focus()}
        maxLength={120}
        editable={!busy}
      />
      <PhoneField
        ref={phoneInput}
        value={phone}
        onChange={(digits) => {
          setPhone(digits);
          if (isPhoneComplete(digits)) pinInput.current?.focus();
        }}
        onSubmit={() => pinInput.current?.focus()}
        editable={!busy}
      />
      <PinCells
        ref={pinInput}
        label="Choose a PIN"
        hint="5 digits you'll use every day. Avoid 12345 or 11111."
        error={pinError ?? undefined}
        value={pin}
        onChange={setPin}
        onComplete={(value) => {
          if (!pinProblem(value)) confirmInput.current?.focus();
        }}
        editable={!busy}
      />
      <PinCells
        ref={confirmInput}
        label="Enter it again"
        error={mismatch ? "The PINs are not the same." : undefined}
        value={confirm}
        onChange={setConfirm}
        editable={!busy}
      />
      {!!error && (
        <Notice message={wait > 0 ? `${error} Try again in ${wait} s.` : error} error />
      )}
      <Button
        title={busy ? "Creating account…" : "Create account"}
        busy={busy}
        disabled={!ready}
        onPress={() => void submit()}
      />
    </AuthLayout>
  );
}
