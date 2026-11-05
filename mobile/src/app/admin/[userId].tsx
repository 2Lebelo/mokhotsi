import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";

import {
  devicesOf,
  ownerShops,
  resetUserPin,
  revokeDevice,
  setShopStatus,
  setUserStatus,
  user as fetchUser,
} from "@/api/endpoints";
import type { DeviceOut, ShopOut } from "@/api/types";
import { useDevice } from "@/auth/device-provider";
import {
  Button,
  Card,
  Divider,
  errorMessage,
  font,
  Label,
  Notice,
  Screen,
  SectionHeader,
  TopBar,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useToast } from "@/components/toast";
import { registeredOn } from "@/features/admin/owner-row";
import { ReviewButtons } from "@/features/admin/review-buttons";
import { ADMIN_USERS } from "@/features/admin/use-admin";

/** One owner, for the system admin: approval, PIN reset, disabling, their shops and phones. */
export default function OwnerScreen() {
  const c = usePalette();
  const toast = useToast();
  const queries = useQueryClient();
  const { api } = useDevice();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const [temporaryPin, setTemporaryPin] = useState<string | null>(null);
  const userKey = ["admin", "user", userId];
  const shopsKey = ["admin", "shops", userId];
  const devicesKey = ["admin", "devices", userId];

  const owner = useQuery({ queryKey: userKey, queryFn: () => fetchUser(api!, userId), enabled: !!api });
  const shops = useQuery({ queryKey: shopsKey, queryFn: () => ownerShops(api!, userId), enabled: !!api });
  const phones = useQuery({ queryKey: devicesKey, queryFn: () => devicesOf(api!, userId), enabled: !!api });

  const refresh = async () => {
    await Promise.all([
      queries.invalidateQueries({ queryKey: userKey }),
      queries.invalidateQueries({ queryKey: shopsKey }),
      queries.invalidateQueries({ queryKey: devicesKey }),
      queries.invalidateQueries({ queryKey: ADMIN_USERS }),
    ]);
  };
  const onError = (error: unknown) => toast.error(errorMessage(error));

  const status = useMutation({
    mutationFn: (next: "active" | "disabled") => setUserStatus(api!, userId, next),
    onSuccess: refresh,
    onError,
  });
  const pin = useMutation({
    mutationFn: () => resetUserPin(api!, userId),
    onSuccess: (result) => setTemporaryPin(result.temporary_pin),
    onError,
  });
  const shopStatus = useMutation({
    mutationFn: ({ shop, next }: { shop: ShopOut; next: "active" | "suspended" }) =>
      setShopStatus(api!, shop.id, next),
    onSuccess: refresh,
    onError,
  });
  const revoke = useMutation({
    mutationFn: (phone: DeviceOut) => revokeDevice(api!, phone.id),
    onSuccess: refresh,
    onError,
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace("/admin"));

  const person = owner.data;
  return (
    <Screen>
      <TopBar title={person?.name ?? "Owner"} subtitle={person?.phone ?? undefined} onBack={back} />
      {owner.isError && <Notice message={errorMessage(owner.error)} error />}
      {person && (
        <Card>
          <Label muted>Registered {registeredOn(person.created_at)}</Label>
          {person.status === "pending" && <ReviewButtons owner={person} />}
          {person.status === "rejected" && (
            <Notice message={`Rejected${person.review_note ? `: ${person.review_note}` : "."}`} error />
          )}
          {(person.status === "active" || person.status === "disabled") && (
            <>
              <Button
                title={person.status === "active" ? "Disable account" : "Enable account"}
                variant={person.status === "active" ? "danger" : "primary"}
                busy={status.isPending}
                onPress={() =>
                  person.status === "active"
                    ? Alert.alert(
                        `Disable ${person.name}?`,
                        "They are signed out everywhere and leave their shops' PIN pads. Their shops keep their data.",
                        [
                          { text: "Cancel", style: "cancel" },
                          { text: "Disable", style: "destructive", onPress: () => status.mutate("disabled") },
                        ],
                      )
                    : status.mutate("active")
                }
              />
              <Button
                title="Reset PIN"
                variant="secondary"
                icon="keypad-outline"
                busy={pin.isPending}
                onPress={() =>
                  Alert.alert(
                    "Reset their PIN?",
                    "Only after you have confirmed who is asking, e.g. by calling their number. Their phones are signed out.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Reset", onPress: () => pin.mutate() },
                    ],
                  )
                }
              />
            </>
          )}
          {temporaryPin && (
            <Notice
              message={`Temporary PIN: ${temporaryPin}. Tell ${person.name}; they must choose their own when they sign in. It is not shown again.`}
            />
          )}
        </Card>
      )}

      <SectionHeader title="Shops" />
      {shops.isError && <Notice message={errorMessage(shops.error)} error />}
      {shops.isSuccess && shops.data.data.length === 0 && <Label muted>No shops yet.</Label>}
      {(shops.data?.data.length ?? 0) > 0 && (
        <Card>
          {shops.data!.data.map((shop, i) => (
            <View key={shop.id}>
              {i > 0 && <Divider />}
              <View style={[ui.row, { minHeight: 52 }]}>
                <View style={ui.grow}>
                  <Text style={[ui.body, font.medium, { color: c.text }]}>{shop.name}</Text>
                  <Text style={[ui.caption, { color: shop.status === "suspended" ? c.danger : c.muted }]}>
                    {shop.status === "suspended" ? "Suspended" : "Active"}
                  </Text>
                </View>
                <Button
                  title={shop.status === "suspended" ? "Reactivate" : "Suspend"}
                  size="sm"
                  variant={shop.status === "suspended" ? "secondary" : "danger"}
                  busy={shopStatus.isPending && shopStatus.variables?.shop.id === shop.id}
                  onPress={() =>
                    shopStatus.mutate({ shop, next: shop.status === "suspended" ? "active" : "suspended" })
                  }
                />
              </View>
            </View>
          ))}
        </Card>
      )}

      <SectionHeader title="Phones" />
      {phones.isError && <Notice message={errorMessage(phones.error)} error />}
      {phones.isSuccess && phones.data.data.length === 0 && <Label muted>No phones.</Label>}
      {(phones.data?.data.length ?? 0) > 0 && (
        <Card>
          {phones.data!.data.map((phone, i) => (
            <View key={phone.id}>
              {i > 0 && <Divider />}
              <View style={[ui.row, { minHeight: 52 }]}>
                <View style={ui.grow}>
                  <Text style={[ui.body, font.medium, { color: c.text }]}>{phone.name}</Text>
                  <Text style={[ui.caption, { color: phone.revoked_at ? c.danger : c.muted }]}>
                    {phone.revoked_at
                      ? "Blocked"
                      : `${phone.shop_ids.length} ${phone.shop_ids.length === 1 ? "shop" : "shops"} · last synced ${
                          phone.last_sync_at ? registeredOn(phone.last_sync_at) : "never"
                        }`}
                  </Text>
                </View>
                {!phone.revoked_at && (
                  <Button
                    title="Block"
                    size="sm"
                    variant="danger"
                    busy={revoke.isPending && revoke.variables?.id === phone.id}
                    onPress={() => revoke.mutate(phone)}
                  />
                )}
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
