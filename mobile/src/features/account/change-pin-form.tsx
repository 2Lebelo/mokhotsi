import { useRef, useState } from "react";
import type { TextInput } from "react-native";

import { changeMyPin } from "@/api/endpoints";
import { useDevice } from "@/auth/device-provider";
import { Button, Notice } from "@/components/shop-ui";
import { useToast } from "@/components/toast";
import { PIN_LENGTH, pinProblem } from "@/domain/pin";
import { PinCells } from "@/features/auth/components/pin-cells";
import { authErrorMessage, retryAt } from "@/features/auth/messages";
import { feedback } from "@/features/feedback";
import { useCountdown } from "@/hooks/use-countdown";
import { useOnline } from "@/hooks/use-online";

/**
 * Change your own PIN, in every shop you belong to (online). Used for a temporary PIN at
 * first sign-in, and from the menu.
 */
export function ChangePinForm({
  currentLabel = "Current PIN",
  onDone,
}: {
  currentLabel?: string;
  onDone?: () => void;
}) {
  const toast = useToast();
  const online = useOnline();
  const { api, hasSession, refreshAccount, refreshRoster } = useDevice();
  const nextInput = useRef<TextInput>(null);
  const confirmInput = useRef<TextInput>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const wait = useCountdown(waitUntil);

  const problem = next.length === PIN_LENGTH ? pinProblem(next) : null;
  const mismatch = confirm.length === PIN_LENGTH && confirm !== next;
  const ready =
    !!api &&
    hasSession &&
    online &&
    wait === 0 &&
    current.length === PIN_LENGTH &&
    next.length === PIN_LENGTH &&
    !problem &&
    confirm === next;

  const submit = async () => {
    if (!api || !ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await changeMyPin(api, current, next);
      feedback.success();
      toast.success("PIN changed");
      // The new PIN tags reach this phone's PIN pad; the account loses its temporary flag.
      await Promise.all([refreshAccount().catch(() => {}), refreshRoster()]);
      onDone?.();
    } catch (cause) {
      feedback.error();
      setShake((n) => n + 1);
      setWaitUntil(retryAt(cause, Date.now()));
      setError(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {!hasSession && (
        <Notice message="Connect to the internet and sign in again to change your PIN." error />
      )}
      <PinCells
        label={currentLabel}
        value={current}
        onChange={setCurrent}
        onComplete={() => nextInput.current?.focus()}
        shakeKey={shake}
        editable={!busy}
      />
      <PinCells
        ref={nextInput}
        label="New PIN"
        hint="It works in all your shops. Avoid 12345 or 11111."
        error={problem ?? undefined}
        value={next}
        onChange={setNext}
        onComplete={(value) => {
          if (!pinProblem(value)) confirmInput.current?.focus();
        }}
        editable={!busy}
      />
      <PinCells
        ref={confirmInput}
        label="New PIN again"
        error={mismatch ? "The PINs are not the same." : undefined}
        value={confirm}
        onChange={setConfirm}
        editable={!busy}
      />
      {!!error && (
        <Notice message={wait > 0 ? `${error} Try again in ${wait} s.` : error} error />
      )}
      <Button
        title={busy ? "Saving…" : "Change PIN"}
        busy={busy}
        disabled={!ready}
        onPress={() => void submit()}
      />
    </>
  );
}
