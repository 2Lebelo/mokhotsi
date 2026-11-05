import { useState } from "react";

import { useSession } from "@/auth/session-provider";
import { Button, Card, errorMessage, Field, Label, Notice } from "@/components/shop-ui";
import { isPinShaped, PIN_LENGTH } from "@/domain/pin";

/**
 * Managing staff and shops happens online, as the person at the till. Their PIN unlocked the
 * phone offline; confirming it here signs them in to the server too.
 */
export function GoOnline({ reason }: { reason: string }) {
  const { goOnline } = useSession();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await goOnline(pin);
    } catch (cause) {
      setError(errorMessage(cause));
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Label>{reason}</Label>
      <Field
        label="Your PIN"
        value={pin}
        onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={PIN_LENGTH}
        onSubmitEditing={() => void submit()}
      />
      {!!error && <Notice message={error} error />}
      <Button
        title="Connect"
        icon="cloud-outline"
        busy={busy}
        disabled={!isPinShaped(pin)}
        onPress={() => void submit()}
      />
    </Card>
  );
}
