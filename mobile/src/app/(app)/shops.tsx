import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { RefreshControl } from "react-native";

import { useDevice } from "@/auth/device-provider";
import { useCan } from "@/auth/session-provider";
import { Notice, Screen, TopBar, usePalette } from "@/components/shop-ui";
import { GoOnline } from "@/features/account/go-online";
import { SHOPS_QUERY, ShopsPanel } from "@/features/shops/shops-panel";

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

/** The owner's shops: open another, or let this phone serve one more. Online only. */
export default function ShopsScreen() {
  const c = usePalette();
  const can = useCan();
  const queries = useQueryClient();
  const { api, hasSession, refreshRoster } = useDevice();
  const [refreshing, setRefreshing] = useState(false);

  if (!can("shop:manage"))
    return (
      <Screen>
        <TopBar title="Shops" onBack={leave} />
        <Notice message="Only the shop owner manages shops." />
      </Screen>
    );
  if (!api || !hasSession)
    return (
      <Screen>
        <TopBar title="Shops" onBack={leave} />
        <GoOnline reason="Opening shops needs the internet. Confirm your PIN to connect." />
      </Screen>
    );
  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={c.accent}
          colors={[c.accent]}
          onRefresh={async () => {
            setRefreshing(true);
            try {
              await Promise.all([
                queries.invalidateQueries({ queryKey: SHOPS_QUERY }),
                refreshRoster(),
              ]);
            } finally {
              setRefreshing(false);
            }
          }}
        />
      }
    >
      <TopBar title="Shops" onBack={leave} />
      <ShopsPanel />
    </Screen>
  );
}
