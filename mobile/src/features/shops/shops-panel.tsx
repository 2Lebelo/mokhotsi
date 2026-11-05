import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { createShop, linkDevice, myShops } from "@/api/endpoints";
import type { ShopOut } from "@/api/types";
import { useDevice } from "@/auth/device-provider";
import { Sheet } from "@/components/sheet";
import {
  Button,
  Card,
  Divider,
  errorMessage,
  Field,
  font,
  Notice,
  SectionHeader,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useToast } from "@/components/toast";
import { PIN_LENGTH } from "@/domain/pin";
import { PinCells } from "@/features/auth/components/pin-cells";
import { authErrorMessage } from "@/features/auth/messages";

export const SHOPS_QUERY = ["my-shops"] as const;

/**
 * An owner's shops, from a phone already set up for one: open another (this phone serves it
 * too), or add a shop this phone does not serve yet. New shops appear on the PIN pad.
 */
export function ShopsPanel() {
  const c = usePalette();
  const toast = useToast();
  const queries = useQueryClient();
  const { api, device, refreshRoster } = useDevice();
  const [opening, setOpening] = useState(false);
  const shops = useQuery({ queryKey: SHOPS_QUERY, queryFn: () => myShops(api!), enabled: !!api });

  const done = async () => {
    await queries.invalidateQueries({ queryKey: SHOPS_QUERY });
    await refreshRoster();
  };

  const link = useMutation({
    mutationFn: (shop: ShopOut) => linkDevice(api!, shop.id, device.deviceId()!),
    onSuccess: async (_, shop) => {
      await done();
      toast.success(`This phone now also serves ${shop.name}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const create = useMutation({
    mutationFn: ({ name, pin }: { name: string; pin: string }) => createShop(api!, name, pin),
    onSuccess: async (shop) => {
      setOpening(false);
      await done();
      toast.success(`${shop.name} is open. Lock the phone to switch to it.`);
    },
  });

  const list = shops.data?.data ?? [];
  return (
    <>
      <SectionHeader
        title="Your shops"
        action={<Button title="Open a shop" size="sm" icon="add" onPress={() => setOpening(true)} />}
      />
      {shops.isPending && <ActivityIndicator color={c.accent} />}
      {shops.isError && <Notice message={errorMessage(shops.error)} error />}
      {list.length > 0 && (
        <Card>
          {list.map((shop, i) => {
            const here = !!device.shop(shop.id);
            return (
              <View key={shop.id} style={{ gap: 12 }}>
                {i > 0 && <Divider />}
                <View style={ui.row}>
                  <Ionicons name="storefront-outline" size={20} color={c.text} />
                  <View style={ui.grow}>
                    <Text style={[ui.body, font.medium, { color: c.text }]}>{shop.name}</Text>
                    <Text
                      style={[
                        ui.caption,
                        { color: shop.status === "suspended" ? c.danger : c.muted },
                      ]}
                    >
                      {shop.status === "suspended"
                        ? "Suspended by Mokhotsi"
                        : here
                          ? "On this phone"
                          : "Not on this phone"}
                    </Text>
                  </View>
                  {!here && shop.status === "active" && (
                    <Button
                      title="Use here"
                      size="sm"
                      variant="secondary"
                      busy={link.isPending && link.variables?.id === shop.id}
                      onPress={() => link.mutate(shop)}
                    />
                  )}
                </View>
              </View>
            );
          })}
        </Card>
      )}
      <OpenShopSheet
        visible={opening}
        busy={create.isPending}
        error={create.error ? authErrorMessage(create.error) : ""}
        onClose={() => {
          setOpening(false);
          create.reset();
        }}
        onSubmit={(name, pin) => create.mutate({ name, pin })}
      />
    </>
  );
}

function OpenShopSheet({
  visible,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (name: string, pin: string) => void;
}) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  return (
    <Sheet
      visible={visible}
      title="Open a shop"
      subtitle="Confirm with your PIN. It is also your PIN in the new shop."
      onClose={onClose}
    >
      <ScrollView contentContainerStyle={ui.stack} keyboardShouldPersistTaps="handled">
        <Field
          label="Shop name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Thaba Bosiu Café"
          autoCapitalize="words"
          maxLength={120}
        />
        <PinCells label="Your PIN" value={pin} onChange={setPin} editable={!busy} />
        {!!error && <Notice message={error} error />}
        <Button
          title={busy ? "Opening…" : "Open shop"}
          busy={busy}
          disabled={!name.trim() || pin.length !== PIN_LENGTH}
          onPress={() => onSubmit(name.trim(), pin)}
        />
      </ScrollView>
    </Sheet>
  );
}
