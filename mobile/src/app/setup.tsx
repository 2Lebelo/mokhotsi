import { useState } from "react";

import { useDevice } from "@/auth/device-provider";
import { useSession } from "@/auth/session-provider";
import { ChangePinForm } from "@/features/account/change-pin-form";
import { AuthLayout, AuthLink } from "@/features/auth/components/auth-layout";
import { ShopStep } from "@/features/onboarding/shop-step";
import { WaitingStep } from "@/features/onboarding/waiting-step";

/** A signed-in owner whose phone has no shop yet: approval, their own PIN, their shop. */
export default function SetupScreen() {
  const { step } = useSession();
  const { account, signOut } = useDevice();
  const [leaving, setLeaving] = useState(false);
  const first = account?.name.split(" ")[0] ?? "";

  const copy =
    step === "waiting"
      ? { title: "Almost there", subtitle: `Thanks for registering, ${first}.` }
      : step === "choose-pin"
        ? {
            title: "Choose your PIN",
            subtitle: "You signed in with a temporary PIN. Choose your own to continue.",
          }
        : {
            title: "Set up your shop",
            subtitle: `You're approved, ${first}. Your shop is one step away.`,
          };

  return (
    <AuthLayout
      title={copy.title}
      subtitle={copy.subtitle}
      footer={
        step !== "finishing" && (
          <AuthLink
            prompt={account ? `Not ${first}?` : ""}
            action={leaving ? "Signing out…" : "Sign out"}
            onPress={() => {
              setLeaving(true);
              void signOut().finally(() => setLeaving(false));
            }}
          />
        )
      }
    >
      {step === "waiting" && <WaitingStep />}
      {step === "choose-pin" && <ChangePinForm currentLabel="Temporary PIN" />}
      {(step === "shop" || step === "finishing") && <ShopStep finishing={step === "finishing"} />}
    </AuthLayout>
  );
}
