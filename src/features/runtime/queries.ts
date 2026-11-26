import { queryOptions } from "@tanstack/react-query";
import { getEvaluation, getSubtestItems } from "../../api/endpoints/runtime";
import { RUNTIME_QUERY_KEY_PREFIX } from "../../api/queryClient";

export const EVALUATION_STALE_TIME_MS = 10_000;
export const SUBTEST_ITEMS_STALE_TIME_MS = 5 * 60_000;
export const RUNTIME_IMAGE_STALE_TIME_MS = 5 * 60_000;

export const runtimeKeys = {
  all: [RUNTIME_QUERY_KEY_PREFIX] as const,
  evaluation: (assignmentId: number) =>
    [RUNTIME_QUERY_KEY_PREFIX, "evaluation", assignmentId] as const,
  subtestItems: (assignmentId: number, attemptId: number, subtestId: number) =>
    [RUNTIME_QUERY_KEY_PREFIX, "subtestItems", assignmentId, attemptId, subtestId] as const,
  image: (assignmentId: number, normalizedUrl: string) =>
    [RUNTIME_QUERY_KEY_PREFIX, "image", assignmentId, normalizedUrl] as const,
};

export function evaluationQueryOptions(assignmentId: number) {
  return queryOptions({
    queryKey: runtimeKeys.evaluation(assignmentId),
    queryFn: () => getEvaluation(),
    staleTime: EVALUATION_STALE_TIME_MS,
  });
}

export function subtestItemsQueryOptions(
  assignmentId: number,
  attemptId: number,
  subtestId: number,
) {
  return queryOptions({
    queryKey: runtimeKeys.subtestItems(assignmentId, attemptId, subtestId),
    queryFn: () => getSubtestItems(attemptId, subtestId),
    staleTime: SUBTEST_ITEMS_STALE_TIME_MS,
  });
}
