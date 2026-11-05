import { router } from "expo-router";

import { useDevice } from "@/auth/device-provider";
import { useSession } from "@/auth/session-provider";
import { Label, Screen, TopBar } from "@/components/shop-ui";
import { GoOnline } from "@/features/account/go-online";
import { ChangePinForm } from "@/features/account/change-pin-form";

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

/** The person at the till changes their own PIN (online). */
export default function ChangePinScreen() {
  const { hasSession } = useDevice();
  const { till } = useSession();
  return (
    <Screen>
      <TopBar title="Change PIN" onBack={leave} />
      {hasSession ? (
        <>
          <Label muted>
            Your new PIN works in all your shops. If someone in a shop already uses it, you will be
            asked to choose another.
          </Label>
          <ChangePinForm onDone={leave} />
        </>
      ) : (
        <GoOnline
          reason={`Changing a PIN needs the internet. Confirm your PIN to connect${
            till.kind === "open" ? `, ${till.member.name}` : ""
          }.`}
        />
      )}
    </Screen>
  );
}
