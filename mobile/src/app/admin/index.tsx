import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { RefreshControl, Text, View } from "react-native";

import { addOwner } from "@/api/endpoints";
import { Sheet } from "@/components/sheet";
import {
  Button,
  Card,
  Chip,
  Divider,
  Empty,
  errorMessage,
  Field,
  font,
  Heading,
  Label,
  Notice,
  Screen,
  ui,
  usePalette,
} from "@/components/shop-ui";
import { useDevice } from "@/auth/device-provider";
import { OwnerRow, registeredOn } from "@/features/admin/owner-row";
import { ReviewButtons } from "@/features/admin/review-buttons";
import { describeIssue } from "@/features/admin/sync-issue-text";
import {
  ADMIN_SYNC_ISSUES,
  ADMIN_USERS,
  useOpenSyncIssueCount,
  useOwners,
  useResolveSyncIssue,
  useSyncIssues,
} from "@/features/admin/use-admin";

/**
 * The system admin's work: owners waiting for approval, every owner, and what shops' phones
 * could not sync as asked. Online only; the admin never reaches the till (see auth/phase.ts).
 */
export default function AdminScreen() {
  const c = usePalette();
  const queries = useQueryClient();
  const { account, signOut } = useDevice();
  const [tab, setTab] = useState<"waiting" | "owners" | "issues">("waiting");
  const openIssues = useOpenSyncIssueCount().data?.open ?? 0;
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [leaving, setLeaving] = useState(false);

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
                queries.invalidateQueries({ queryKey: ADMIN_USERS }),
                queries.invalidateQueries({ queryKey: ADMIN_SYNC_ISSUES }),
              ]);
            } finally {
              setRefreshing(false);
            }
          }}
        />
      }
    >
      <Heading
        title="Admin"
        subtitle={account ? `Signed in as ${account.name}` : undefined}
        action={
          <Button
            title="Add owner"
            size="sm"
            variant="secondary"
            icon="person-add-outline"
            onPress={() => setAdding(true)}
          />
        }
      />
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        <Chip label="Waiting" selected={tab === "waiting"} onPress={() => setTab("waiting")} />
        <Chip label="All owners" selected={tab === "owners"} onPress={() => setTab("owners")} />
        <Chip
          label={openIssues > 0 ? `Needs attention (${openIssues})` : "Needs attention"}
          selected={tab === "issues"}
          onPress={() => setTab("issues")}
        />
      </View>
      {tab === "waiting" ? <Waiting /> : tab === "owners" ? <Owners /> : <SyncIssues />}
      <View style={[ui.row, { gap: 10, marginTop: 8 }]}>
        <View style={ui.grow}>
          <Button
            title="Change PIN"
            variant="secondary"
            icon="keypad-outline"
            onPress={() => router.push("/admin/pin")}
          />
        </View>
        <View style={ui.grow}>
          <Button
            title={leaving ? "Signing out…" : "Sign out"}
            variant="ghost"
            busy={leaving}
            onPress={() => {
              setLeaving(true);
              void signOut().finally(() => setLeaving(false));
            }}
          />
        </View>
      </View>
      <AddOwnerSheet visible={adding} onClose={() => setAdding(false)} />
    </Screen>
  );
}

function Waiting() {
  const c = usePalette();
  const pending = useOwners({ status: "pending" });
  const owners = pending.data?.pages.flatMap((page) => page.data) ?? [];
  if (pending.isError) return <Notice message={errorMessage(pending.error)} error />;
  if (pending.isSuccess && owners.length === 0)
    return <Empty icon="checkmark-done-outline" title="Nobody is waiting" description="New registrations appear here." />;
  return (
    <>
      {owners.map((owner) => (
        <Card key={owner.id}>
          <View>
            <Text style={[ui.sectionTitle, { color: c.text }]}>{owner.name}</Text>
            <Text style={[ui.body, font.medium, { color: c.text }]}>{owner.phone}</Text>
            <Text style={[ui.caption, { color: c.muted }]}>Registered {registeredOn(owner.created_at)}</Text>
          </View>
          <Label muted>Call the number to confirm who they are before approving.</Label>
          <ReviewButtons owner={owner} />
        </Card>
      ))}
      {pending.hasNextPage && (
        <Button title="Show more" variant="secondary" busy={pending.isFetchingNextPage} onPress={() => void pending.fetchNextPage()} />
      )}
    </>
  );
}

function Owners() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  // Wait for a pause in typing, so each keystroke is not a request.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);
  const owners = useOwners({ q: search || undefined });
  const list = owners.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <>
      <Field icon="search" placeholder="Name or phone number" value={query} onChangeText={setQuery} autoCorrect={false} />
      {owners.isError && <Notice message={errorMessage(owners.error)} error />}
      {owners.isSuccess && list.length === 0 && <Notice message="No owner matches." />}
      {list.length > 0 && (
        <Card>
          {list.map((owner, i) => (
            <View key={owner.id}>
              {i > 0 && <Divider />}
              <OwnerRow
                owner={owner}
                onPress={() => router.push({ pathname: "/admin/[userId]", params: { userId: owner.id } })}
              />
            </View>
          ))}
        </Card>
      )}
      {owners.hasNextPage && (
        <Button title="Show more" variant="secondary" busy={owners.isFetchingNextPage} onPress={() => void owners.fetchNextPage()} />
      )}
    </>
  );
}

function SyncIssues() {
  const c = usePalette();
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const issues = useSyncIssues(status);
  const resolve = useResolveSyncIssue();
  const list = issues.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <>
      <View style={[ui.row, { gap: 8 }]}>
        <Chip label="Open" selected={status === "open"} onPress={() => setStatus("open")} />
        <Chip label="Resolved" selected={status === "resolved"} onPress={() => setStatus("resolved")} />
      </View>
      {issues.isError && <Notice message={errorMessage(issues.error)} error />}
      {resolve.isError && <Notice message={errorMessage(resolve.error)} error />}
      {issues.isSuccess && list.length === 0 && (
        <Empty
          icon="checkmark-done-outline"
          title="Nothing to look at"
          description={
            status === "open"
              ? "Every shop's phones synced their changes as they were made."
              : "Resolved issues appear here for 180 days."
          }
        />
      )}
      {list.map((issue) => {
        const { title, detail } = describeIssue(issue);
        const where = [issue.shop_name ?? "Unknown shop", issue.owner_name, issue.owner_phone]
          .filter(Boolean)
          .join(" · ");
        return (
          <Card key={issue.id}>
            <View style={ui.stack}>
              <Text style={[ui.body, font.medium, { color: c.text }]}>{title}</Text>
              <Text style={[ui.caption, { color: c.muted }]}>{detail}</Text>
              <Text style={[ui.caption, { color: c.muted }]}>{where}</Text>
              <Text style={[ui.caption, { color: c.faint }]}>
                {issue.device_name ? `${issue.device_name} · ` : ""}
                {new Date(issue.created_at).toLocaleString()}
              </Text>
              {issue.resolved_at === null && (
                <Button
                  title="Mark resolved"
                  size="sm"
                  variant="secondary"
                  busy={resolve.isPending && resolve.variables === issue.id}
                  onPress={() => resolve.mutate(issue.id)}
                />
              )}
            </View>
          </Card>
        );
      })}
      {issues.hasNextPage && (
        <Button title="Show more" variant="secondary" busy={issues.isFetchingNextPage} onPress={() => void issues.fetchNextPage()} />
      )}
    </>
  );
}

function AddOwnerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { api } = useDevice();
  const queries = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const add = useMutation({
    mutationFn: () => addOwner(api!, name.trim(), phone),
    onSuccess: () => queries.invalidateQueries({ queryKey: ADMIN_USERS }),
  });
  const close = () => {
    add.reset();
    setName("");
    setPhone("");
    onClose();
  };
  return (
    <Sheet visible={visible} title="Add an owner" subtitle="Already checked, so approved at once." onClose={close}>
      {add.data ? (
        <>
          <Notice message={`Tell ${add.data.user.name} their temporary PIN: ${add.data.temporary_pin}. They choose their own when they first sign in. It is not shown again.`} />
          <Button title="Done" onPress={close} />
        </>
      ) : (
        <>
          <Field label="Name" value={name} onChangeText={setName} maxLength={120} />
          <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          {add.isError && <Notice message={errorMessage(add.error)} error />}
          <Button title="Add owner" busy={add.isPending} disabled={!name.trim() || phone.trim().length < 6} onPress={() => add.mutate()} />
        </>
      )}
    </Sheet>
  );
}
