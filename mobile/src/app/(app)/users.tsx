import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import {
  addCashier,
  members as fetchMembers,
  removeCashier,
  revokeDevice,
  setCashierPermissions,
  setCashierPin,
  shopDevices,
  unlinkDevice,
} from "@/api/endpoints";
import type { DeviceOut, MemberOut } from "@/api/types";
import { useDevice } from "@/auth/device-provider";
import { useSession } from "@/auth/session-provider";
import { Sheet } from "@/components/sheet";
import {
  Button,
  Card,
  Divider,
  errorMessage,
  Field,
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
import { GRANT_LABELS, isGrantable, isPermission, type Permission } from "@/domain/permissions";
import { PIN_LENGTH, pinProblem } from "@/domain/pin";
import { GoOnline } from "@/features/account/go-online";
import { PermissionToggles } from "@/features/staff/permission-toggles";

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

function digits(value: string) {
  return value.replace(/\D/g, "").slice(0, PIN_LENGTH);
}

function granted(member: MemberOut): Permission[] {
  return member.granted_permissions.filter(isPermission);
}

function summary(member: MemberOut): string {
  const extras = granted(member)
    .filter(isGrantable)
    .map((p) => GRANT_LABELS[p].toLowerCase());
  return extras.length ? `Sells, ${extras.join(", ")}` : "Sells only";
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** The shop's cashiers and phones, managed online by the owner. */
export default function UsersScreen() {
  const { till, can } = useSession();
  const { api, hasSession } = useDevice();
  if (till.kind !== "open") return null; // Only reachable behind the PIN (root layout).
  if (!can("members:manage"))
    return (
      <Screen>
        <TopBar title="Users" onBack={leave} />
        <Notice message="Only the shop owner manages users." />
      </Screen>
    );
  if (!api || !hasSession)
    return (
      <Screen>
        <TopBar title="Users" subtitle={till.shop.name} onBack={leave} />
        <GoOnline reason="Adding cashiers and changing PINs needs the internet. Confirm your PIN to connect." />
      </Screen>
    );
  return <Staff shopId={till.shop.id} shopName={till.shop.name} canManagePhones={can("devices:manage")} />;
}

function Staff({ shopId, shopName, canManagePhones }: { shopId: string; shopName: string; canManagePhones: boolean }) {
  const c = usePalette();
  const toast = useToast();
  const queries = useQueryClient();
  const { api, device, refreshRoster } = useDevice();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MemberOut | null>(null);
  const membersKey = ["members", shopId];
  const devicesKey = ["shop-devices", shopId];

  const team = useQuery({ queryKey: membersKey, queryFn: () => fetchMembers(api!, shopId) });
  const phones = useQuery({
    queryKey: devicesKey,
    queryFn: () => shopDevices(api!, shopId),
    enabled: canManagePhones,
  });

  // Every change reaches this phone's PIN pad at once, and the shop's other phones on their
  // next roster check.
  const changed = async () => {
    await queries.invalidateQueries({ queryKey: membersKey });
    await queries.invalidateQueries({ queryKey: devicesKey });
    await refreshRoster();
  };

  const removePhone = useMutation({
    mutationFn: async ({ phone, revoke }: { phone: DeviceOut; revoke: boolean }) => {
      if (revoke) await revokeDevice(api!, phone.id);
      else await unlinkDevice(api!, shopId, phone.id);
    },
    onSuccess: async () => {
      toast.success("Phone removed");
      await changed();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const [refreshing, setRefreshing] = useState(false);
  const pullToRefresh = (
    <RefreshControl
      refreshing={refreshing}
      tintColor={c.accent}
      colors={[c.accent]}
      onRefresh={async () => {
        setRefreshing(true);
        try {
          await changed();
        } finally {
          setRefreshing(false);
        }
      }}
    />
  );

  const cashiers = (team.data?.data ?? []).filter((m) => m.role === "cashier");
  const owners = (team.data?.data ?? []).filter((m) => m.role === "owner");
  const thisPhone = device.deviceId();

  return (
    <Screen refreshControl={pullToRefresh}>
      <TopBar title="Users" subtitle={shopName} onBack={leave} />

      {team.isPending && <ActivityIndicator color={c.accent} />}
      <SectionHeader
        title="Cashiers"
        action={<Button title="Add" size="sm" icon="person-add-outline" onPress={() => setAdding(true)} />}
      />
      {team.isError && <Notice message={errorMessage(team.error)} error />}
      {team.isSuccess && cashiers.length === 0 && (
        <Notice message="No cashiers yet. Add one and give them a PIN; they sign in on this shop's phones." />
      )}
      {cashiers.length > 0 && (
        <Card>
          {cashiers.map((member, i) => (
            <View key={member.user_id}>
              {i > 0 && <Divider />}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${member.user.name}. ${summary(member)}`}
                onPress={() => setEditing(member)}
                style={({ pressed }) => [ui.row, { minHeight: 56, opacity: pressed ? 0.6 : 1 }]}
              >
                <View style={[styles.avatar, { backgroundColor: c.tint }]}>
                  <Text style={[font.semibold, { color: c.accent }]}>
                    {member.user.name.trim().slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={ui.grow}>
                  <Text style={[ui.body, font.medium, { color: c.text }]}>{member.user.name}</Text>
                  <Text style={[ui.caption, { color: c.muted }]}>{summary(member)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.faint} />
              </Pressable>
            </View>
          ))}
        </Card>
      )}
      {owners.length > 0 && (
        <Label muted>Owner: {owners.map((o) => o.user.name).join(", ")}. Owners can do everything.</Label>
      )}

      {canManagePhones && (
        <>
          <SectionHeader title="Phones" />
          {phones.isError && <Notice message={errorMessage(phones.error)} error />}
          {(phones.data?.data ?? []).length > 0 && (
            <Card>
              {(phones.data?.data ?? []).map((phone, i) => (
                <View key={phone.id} style={{ gap: 8 }}>
                  {i > 0 && <Divider />}
                  <View style={ui.row}>
                    <Ionicons name="phone-portrait-outline" size={20} color={c.text} />
                    <View style={ui.grow}>
                      <Text style={[ui.body, font.medium, { color: c.text }]}>
                        {phone.name}
                        {phone.id === thisPhone ? " (this phone)" : ""}
                      </Text>
                      <Text style={[ui.caption, { color: phone.revoked_at ? c.danger : c.muted }]}>
                        {phone.revoked_at
                          ? "Blocked"
                          : `Last seen ${ago(phone.last_seen_at)} · synced ${ago(phone.last_sync_at)}`}
                      </Text>
                    </View>
                    {phone.id !== thisPhone && !phone.revoked_at && (
                      <Button
                        title="Remove"
                        size="sm"
                        variant="danger"
                        busy={removePhone.isPending && removePhone.variables?.phone.id === phone.id}
                        onPress={() =>
                          Alert.alert(
                            `Remove ${phone.name}?`,
                            "Remove it from this shop, or block it if it was lost or stolen: a blocked phone stops syncing and everyone on it is signed out.",
                            [
                              { text: "Cancel", style: "cancel" },
                              { text: "Remove from shop", onPress: () => removePhone.mutate({ phone, revoke: false }) },
                              { text: "Block phone", style: "destructive", onPress: () => removePhone.mutate({ phone, revoke: true }) },
                            ],
                          )
                        }
                      />
                    )}
                  </View>
                </View>
              ))}
            </Card>
          )}
          <Label muted>
            To add a phone, sign in on it with your phone number and PIN, then choose this shop.
          </Label>
        </>
      )}

      <AddCashierSheet
        visible={adding}
        shopId={shopId}
        onClose={() => setAdding(false)}
        onAdded={async (name) => {
          setAdding(false);
          toast.success(`${name} can now sign in with their PIN`);
          await changed();
        }}
      />
      {editing && (
        <CashierSheet
          member={editing}
          shopId={shopId}
          onClose={() => setEditing(null)}
          onChanged={async (message) => {
            setEditing(null);
            toast.success(message);
            await changed();
          }}
        />
      )}
    </Screen>
  );
}

function PinFields({
  pin,
  confirm,
  onPin,
  onConfirm,
  label = "PIN",
}: {
  pin: string;
  confirm: string;
  onPin: (value: string) => void;
  onConfirm: (value: string) => void;
  label?: string;
}) {
  const problem = pin.length === PIN_LENGTH ? pinProblem(pin) : null;
  return (
    <>
      <Field
        label={label}
        hint="Tell the cashier their PIN yourself. Each person in the shop needs a different one."
        error={problem ?? undefined}
        value={pin}
        onChangeText={(value) => onPin(digits(value))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={PIN_LENGTH}
      />
      <Field
        label={`${label} again`}
        error={confirm.length === PIN_LENGTH && confirm !== pin ? "The PINs are not the same." : undefined}
        value={confirm}
        onChangeText={(value) => onConfirm(digits(value))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={PIN_LENGTH}
      />
    </>
  );
}

function AddCashierSheet({
  visible,
  shopId,
  onClose,
  onAdded,
}: {
  visible: boolean;
  shopId: string;
  onClose: () => void;
  onAdded: (name: string) => void;
}) {
  const { api } = useDevice();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const add = useMutation({
    mutationFn: () => addCashier(api!, shopId, { name: name.trim(), pin, permissions }),
    onSuccess: () => {
      onAdded(name.trim());
      setName("");
      setPin("");
      setConfirm("");
      setPermissions([]);
    },
  });
  return (
    <Sheet visible={visible} title="Add a cashier" subtitle="They can sell straight away." onClose={onClose}>
      <ScrollView contentContainerStyle={ui.stack} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <Field label="Name" value={name} onChangeText={setName} maxLength={120} autoCapitalize="words" />
      <PinFields pin={pin} confirm={confirm} onPin={setPin} onConfirm={setConfirm} />
      <PermissionToggles value={permissions} onChange={setPermissions} />
      {add.isError && <Notice message={errorMessage(add.error)} error />}
      <Button
        title="Add cashier"
        busy={add.isPending}
        disabled={!name.trim() || !!pinProblem(pin) || confirm !== pin}
        onPress={() => add.mutate()}
      />
      </ScrollView>
    </Sheet>
  );
}

function CashierSheet({
  member,
  shopId,
  onClose,
  onChanged,
}: {
  member: MemberOut;
  shopId: string;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { api } = useDevice();
  const [permissions, setPermissions] = useState<Permission[]>(granted(member));
  const [newPin, setNewPin] = useState<{ pin: string; confirm: string } | null>(null);
  const userId = member.user_id;

  const save = useMutation({
    mutationFn: () => setCashierPermissions(api!, shopId, userId, permissions),
    onSuccess: () => onChanged("Saved"),
  });
  const pin = useMutation({
    mutationFn: (value: string) => setCashierPin(api!, shopId, userId, value),
    onSuccess: () => onChanged(`${member.user.name}'s PIN changed`),
  });
  const remove = useMutation({
    mutationFn: () => removeCashier(api!, shopId, userId),
    onSuccess: () => onChanged(`${member.user.name} removed`),
  });
  const error = save.error ?? pin.error ?? remove.error;
  const changedPermissions =
    [...permissions].sort().join() !== [...granted(member)].sort().join();

  return (
    <Sheet visible title={member.user.name} subtitle="Cashier" onClose={onClose}>
      <ScrollView contentContainerStyle={ui.stack} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <PermissionToggles value={permissions} onChange={setPermissions} />
      {changedPermissions && (
        <Button title="Save changes" busy={save.isPending} onPress={() => save.mutate()} />
      )}
      {newPin ? (
        <>
          <PinFields
            label="New PIN"
            pin={newPin.pin}
            confirm={newPin.confirm}
            onPin={(value) => setNewPin({ ...newPin, pin: value })}
            onConfirm={(value) => setNewPin({ ...newPin, confirm: value })}
          />
          <Button
            title="Set new PIN"
            busy={pin.isPending}
            disabled={!!pinProblem(newPin.pin) || newPin.confirm !== newPin.pin}
            onPress={() => pin.mutate(newPin.pin)}
          />
        </>
      ) : (
        <Button title="Set a new PIN" variant="secondary" icon="keypad-outline" onPress={() => setNewPin({ pin: "", confirm: "" })} />
      )}
      {!!error && <Notice message={errorMessage(error)} error />}
      <Button
        title="Remove from shop"
        variant="danger"
        icon="person-remove-outline"
        busy={remove.isPending}
        onPress={() =>
          Alert.alert(
            `Remove ${member.user.name}?`,
            "They can no longer sign in. Sales they already made stay in your records.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Remove", style: "destructive", onPress: () => remove.mutate() },
            ],
          )
        }
      />
      </ScrollView>
    </Sheet>
  );
}

const styles = {
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
} as const;
