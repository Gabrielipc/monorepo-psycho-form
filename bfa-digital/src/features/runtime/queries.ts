import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { getSubtestItems } from "../../api/endpoints/runtime";
import { RUNTIME_QUERY_KEY_PREFIX } from "../../api/queryClient";
import type { Evaluation } from "../../api/schemas/runtime";
import { fetchEvaluationWithTicket, isTicketCurrent } from "./evaluation-guard";

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

/**
 * El fetcher por defecto SIEMPRE asigna el ticket de vigencia al INICIAR la solicitud (F2-FIX-4/5): no existe una
 * variante sin ticket. El parámetro `fetcher` solo existe para tests.
 */
export function evaluationQueryOptions(
  assignmentId: number,
  fetcher: () => Promise<Evaluation> = fetchEvaluationWithTicket,
) {
  return queryOptions({
    queryKey: runtimeKeys.evaluation(assignmentId),
    queryFn: fetcher,
    // Cada respuesta conserva su identidad de objeto: el ticket de vigencia se asocia por identidad.
    structuralSharing: false,
    staleTime: EVALUATION_STALE_TIME_MS,
  });
}

/**
 * /yo VIGENTE para los loaders de /evaluacion (F2-FIX-6). Un loader nunca decide (redirige) con un /yo cuyo ticket
 * quedó invalidado: si el dato de la caché no es vigente se vuelve a pedir UNA vez, con el fetcher que asigna ticket.
 * Devuelve `null` si no puede confirmar (falla, o la nueva respuesta también se invalidó): el loader entonces NO
 * redirige y deja montar la ruta; las guardas reactivas del runner corrigen después con el /yo vigente.
 */
export async function ensureCurrentEvaluation(
  queryClient: QueryClient,
  assignmentId: number,
): Promise<Evaluation | null> {
  let cached: Evaluation;
  try {
    cached = await queryClient.ensureQueryData(evaluationQueryOptions(assignmentId));
  } catch {
    return null;
  }
  if (isTicketCurrent(cached)) return cached;
  try {
    // `retry: false` (F2-FIX-7): el loader hace UN solo refetch; los dos reintentos globales de producción lo
    // convertirían en hasta tres solicitudes y retrasarían la navegación.
    const fresh = await queryClient.fetchQuery({
      ...evaluationQueryOptions(assignmentId),
      staleTime: 0,
      retry: false,
    });
    return isTicketCurrent(fresh) ? fresh : null;
  } catch {
    return null;
  }
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
