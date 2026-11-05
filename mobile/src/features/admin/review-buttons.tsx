import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";

import { reviewOwner } from "@/api/endpoints";
import type { UserOut } from "@/api/types";
import { useDevice } from "@/auth/device-provider";
import { Sheet } from "@/components/sheet";
import { Button, errorMessage, Field, Notice, ui } from "@/components/shop-ui";
import { useToast } from "@/components/toast";
import { ADMIN_USERS } from "@/features/admin/use-admin";

/** Approve or reject a waiting owner. A rejection records why, for the admins and the audit log. */
export function ReviewButtons({ owner }: { owner: UserOut }) {
  const { api } = useDevice();
  const toast = useToast();
  const queries = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const review = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      reviewOwner(api!, owner.id, decision, decision === "reject" ? note.trim() || null : null),
    onSuccess: async (updated) => {
      setRejecting(false);
      toast.success(updated.status === "active" ? `${owner.name} approved` : `${owner.name} rejected`);
      await queries.invalidateQueries({ queryKey: ADMIN_USERS });
      await queries.invalidateQueries({ queryKey: ["admin", "user", owner.id] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <View style={[ui.row, { gap: 10 }]}>
        <View style={ui.grow}>
          <Button
            title="Approve"
            icon="checkmark"
            busy={review.isPending && review.variables === "approve"}
            onPress={() => review.mutate("approve")}
          />
        </View>
        <View style={ui.grow}>
          <Button title="Reject" variant="danger" onPress={() => setRejecting(true)} />
        </View>
      </View>
      <Sheet
        visible={rejecting}
        title={`Reject ${owner.name}?`}
        subtitle="They are signed out and cannot open shops. Their phone keeps working on its own."
        onClose={() => setRejecting(false)}
      >
        <Field
          label="Reason (kept with the record)"
          value={note}
          onChangeText={setNote}
          placeholder="e.g. We could not reach you on this number"
          maxLength={500}
          multiline
        />
        {review.isError && <Notice message={errorMessage(review.error)} error />}
        <Button
          title="Reject"
          variant="danger"
          busy={review.isPending && review.variables === "reject"}
          onPress={() => review.mutate("reject")}
        />
      </Sheet>
    </>
  );
}
