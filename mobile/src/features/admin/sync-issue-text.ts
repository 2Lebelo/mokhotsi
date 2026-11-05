import type { SyncIssueOut } from "../../api/types.ts";

const EXPLAINED: Record<string, string> = {
  permission_denied: "was made by someone no longer allowed to edit the catalogue",
  unknown_actor: "was made by someone who does not work at this shop",
  unknown_sale: "refers to a sale the server does not have",
  unknown_variant: "refers to a size the server does not have",
  unknown_product: "refers to a product the server does not have",
  id_conflict: "clashes with another shop's data",
  invalid_payload: "could not be read by the server",
  total_mismatch: "has totals that do not add up",
};

const ENTITY: Record<string, string> = {
  products: "A product change",
  sales: "A sale",
  reversals: "A refund",
  stock_movements: "A stock change",
  stock_levels: "A stock count",
  embeddings: "A photo match",
};

/** Plain words for an issue a phone reported, for the system admin. */
export function describeIssue(
  issue: Pick<SyncIssueOut, "kind" | "entity" | "code" | "message">,
): { title: string; detail: string } {
  const what = ENTITY[issue.entity] ?? "A change";
  if (issue.kind === "flagged")
    return {
      title: `${what} needs a look`,
      detail: "It was kept, but the person who made it was removed or no longer allowed to.",
    };
  if (issue.code === "missing_reference")
    return {
      title: `${what} from another phone is still waiting`,
      detail: `${issue.message}. The phone keeps it and applies it as soon as that arrives.`,
    };
  if (issue.kind === "conflict")
    return {
      title: `${what} from another phone did not fit`,
      detail: issue.message,
    };
  const reason = EXPLAINED[issue.code];
  return {
    title: `${what} was not accepted`,
    detail: reason ? `It ${reason}.` : issue.message,
  };
}
