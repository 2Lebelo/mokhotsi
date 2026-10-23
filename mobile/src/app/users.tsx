import { router } from "expo-router";

import { Empty, Screen, TopBar } from "@/components/shop-ui";

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

/** Reserved for staff accounts and roles; the dock menu shows it as coming soon. */
export default function UsersScreen() {
  return (
    <Screen>
      <TopBar title="Users" onBack={leave} />
      <Empty
        icon="people-outline"
        title="Coming soon"
        description="Staff accounts and roles will be managed here."
      />
    </Screen>
  );
}
