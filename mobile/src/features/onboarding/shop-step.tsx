import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { errorCode } from "@/api/client";
import { claimShopData, createShop, linkDevice, myShops } from "@/api/endpoints";
import type { ShopOut } from "@/api/types";
import { useDevice } from "@/auth/device-provider";
import { useSession } from "@/auth/session-provider";
import {
  Button,
  Card,
  Divider,
  errorMessage,
  Field,
  font,
  Notice,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useToast } from "@/components/toast";
import { hasLocalShopData } from "@/db/local-data";
import { PIN_LENGTH } from "@/domain/pin";
import { PinCells } from "@/features/auth/components/pin-cells";
import { authErrorMessage } from "@/features/auth/messages";
import { SHOPS_QUERY } from "@/features/shops/shops-panel";

/**
 * Approved: give this phone a shop. An owner with no shop names their first one; an owner
 * with shops picks one for this phone, or opens another. Either way the phone then opens
 * straight on the till as the owner. Items and sales already on the phone come along, once.
 */
export function ShopStep({ finishing }: { finishing: boolean }) {
  const c = usePalette();
  const toast = useToast();
  const { api, device } = useDevice();
  const { setUpPhone } = useSession();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  // Kept here, not in the form: the form is replaced by a spinner while the phone is set up,
  // and comes back filled in if that fails.
  const [draft, setDraft] = useState({ name: "", pin: "" });
  const shops = useQuery({ queryKey: SHOPS_QUERY, queryFn: () => myShops(api!), enabled: !!api });

  /** Decided before the shop exists: afterwards the phone already has one. */
  const shouldClaim = async () => device.claimedShopId() === null && (await hasLocalShopData());

  const claim = async (shopId: string) => {
    try {
      await claimShopData(api!, shopId);
      device.recordClaim(shopId);
    } catch (cause) {
      if (errorCode(cause) !== "data_already_claimed") throw cause;
      toast.info("Another phone already brought its items into this shop, so this phone uses those.");
    }
  };

  const run = async (task: (claimData: boolean) => Promise<ShopOut>) => {
    setError("");
    try {
      let name = "";
      await setUpPhone(async () => {
        const shop = await task(await shouldClaim());
        name = shop.name;
        return shop.id;
      });
      toast.success(`${name} is ready`);
    } catch (cause) {
      setError(authErrorMessage(cause));
      setDraft((value) => ({ ...value, pin: "" }));
      void shops.refetch();
    }
  };

  if (finishing)
    return (
      <Card style={styles.center}>
        <ActivityIndicator color={c.accent} />
        <Text style={[ui.body, { color: c.muted }]}>Setting up this phone…</Text>
      </Card>
    );

  if (shops.isPending)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={c.accent} />
      </View>
    );

  if (shops.isError)
    return (
      <>
        <Notice message={errorMessage(shops.error)} error />
        <Button title="Try again" variant="secondary" icon="refresh" onPress={() => void shops.refetch()} />
      </>
    );

  const list = shops.data.data;
  if (list.length === 0 || creating)
    return (
      <NameShopForm
        first={list.length === 0}
        draft={draft}
        onDraft={setDraft}
        error={error}
        onCancel={list.length > 0 ? () => setCreating(false) : undefined}
        onSubmit={(name, pin) =>
          run(async (claimData) => {
            const shop = await createShop(api!, name, pin); // Also registers this phone to it.
            if (claimData) await claim(shop.id);
            return shop;
          })
        }
      />
    );

  return (
    <>
      <Text style={[ui.body, { color: c.muted }]}>Which shop is this phone for?</Text>
      <Card style={{ paddingVertical: 4, gap: 0 }}>
        {list.map((shop, i) => (
          <View key={shop.id}>
            {i > 0 && <Divider />}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Use this phone for ${shop.name}`}
              disabled={shop.status !== "active"}
              onPress={() =>
                void run(async (claimData) => {
                  await linkDevice(api!, shop.id, device.deviceId()!);
                  if (claimData) await claim(shop.id);
                  return shop;
                })
              }
              style={({ pressed }) => [
                ui.row,
                styles.shop,
                { opacity: shop.status !== "active" ? 0.5 : pressed ? 0.6 : 1 },
              ]}
            >
              <View style={[styles.icon, { backgroundColor: c.subtle }]}>
                <Ionicons name="storefront-outline" size={18} color={c.text} />
              </View>
              <View style={ui.grow}>
                <Text style={[ui.body, font.medium, { color: c.text }]}>{shop.name}</Text>
                {shop.status !== "active" && (
                  <Text style={[ui.caption, { color: c.danger }]}>Suspended</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.faint} />
            </Pressable>
          </View>
        ))}
      </Card>
      {!!error && <Notice message={error} error />}
      <Button title="Open a new shop" variant="secondary" icon="add" onPress={() => setCreating(true)} />
    </>
  );
}

function NameShopForm({
  first,
  draft,
  onDraft,
  error,
  onCancel,
  onSubmit,
}: {
  first: boolean;
  draft: { name: string; pin: string };
  onDraft: (draft: { name: string; pin: string }) => void;
  error: string;
  onCancel?: () => void;
  onSubmit: (name: string, pin: string) => Promise<void>;
}) {
  const { name, pin } = draft;
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(name.trim(), pin);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Field
        label={first ? "Name your shop" : "New shop's name"}
        placeholder="e.g. Thaba Bosiu Café"
        value={name}
        onChangeText={(value) => onDraft({ ...draft, name: value })}
        autoCapitalize="words"
        maxLength={120}
        editable={!busy}
      />
      <PinCells
        label="Your PIN"
        hint="To confirm it's you. It is also your PIN in this shop."
        value={pin}
        onChange={(value) => onDraft({ ...draft, pin: value })}
        editable={!busy}
      />
      {!!error && <Notice message={error} error />}
      <Button
        title={busy ? "Opening…" : first ? "Open my shop" : "Open shop"}
        busy={busy}
        disabled={!name.trim() || pin.length !== PIN_LENGTH}
        onPress={() => void submit()}
      />
      {onCancel && <Button title="Back to my shops" variant="ghost" onPress={onCancel} />}
    </>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", paddingVertical: 28, gap: 12 },
  loading: { paddingVertical: 40, alignItems: "center" },
  shop: { minHeight: 60, paddingVertical: 10 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
