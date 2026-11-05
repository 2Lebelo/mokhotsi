import { router } from "expo-router";

import { Label, Screen, TopBar } from "@/components/shop-ui";
import { ChangePinForm } from "@/features/account/change-pin-form";

function back() {
  if (router.canGoBack()) router.back();
  else router.replace("/admin");
}

/** The system admin changes their own PIN. */
export default function AdminPinScreen() {
  return (
    <Screen>
      <TopBar title="Change PIN" onBack={back} />
      <Label muted>Your PIN signs you in to every shop’s records. Keep it to yourself.</Label>
      <ChangePinForm onDone={back} />
    </Screen>
  );
}
