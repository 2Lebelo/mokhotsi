import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { resolveSyncIssue, syncIssueCount, syncIssues, users } from "@/api/endpoints";
import type { UserStatus } from "@/api/types";
import { useDevice } from "@/auth/device-provider";

export const ADMIN_USERS = ["admin", "users"] as const;
export const ADMIN_SYNC_ISSUES = ["admin", "sync-issues"] as const;

/** Owners, a page at a time (keyset pages from the API). */
export function useOwners(filters: { status?: UserStatus; q?: string }) {
  const { api } = useDevice();
  return useInfiniteQuery({
    queryKey: [...ADMIN_USERS, filters],
    queryFn: ({ pageParam }) =>
      users(api!, { role: "owner", ...filters, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page.next_cursor,
    enabled: !!api,
  });
}

/** What phones could not sync as asked, newest first, a page at a time. */
export function useSyncIssues(status: "open" | "resolved") {
  const { api } = useDevice();
  return useInfiniteQuery({
    queryKey: [...ADMIN_SYNC_ISSUES, status],
    queryFn: ({ pageParam }) => syncIssues(api!, { status, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page.next_cursor,
    enabled: !!api,
  });
}

export function useOpenSyncIssueCount() {
  const { api } = useDevice();
  return useQuery({
    queryKey: [...ADMIN_SYNC_ISSUES, "count"],
    queryFn: () => syncIssueCount(api!),
    enabled: !!api,
  });
}

export function useResolveSyncIssue() {
  const { api } = useDevice();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (issueId: string) => resolveSyncIssue(api!, issueId),
    onSuccess: () => queries.invalidateQueries({ queryKey: ADMIN_SYNC_ISSUES }),
  });
}
