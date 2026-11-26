import { z } from "zod";

/**
 * Search de `/app/calificaciones`. «Calificar» en el monitor envía `{ sessionId, attemptId }`;
 * cada valor se valida por separado y uno inválido se ignora (la pantalla queda sin preselección).
 */
export const gradingSearchSchema = z.object({
  sessionId: z.coerce.number().int().positive().optional().catch(undefined),
  attemptId: z.coerce.number().int().positive().optional().catch(undefined),
});

export type GradingSearch = z.output<typeof gradingSearchSchema>;

/** Id de sesión (texto, como lo maneja la pantalla legacy) a seleccionar: el pedido si existe en la lista. */
export function pickSessionId(
  sessions: readonly { id: string }[],
  requested: number | undefined,
  current: string,
): string {
  if (sessions.length === 0) return current;
  if (current !== "" && sessions.some((s) => s.id === current)) return current;
  if (requested !== undefined && sessions.some((s) => s.id === String(requested))) return String(requested);
  return sessions[0].id;
}

export interface GradingSelection {
  /** Id de sesión a mantener seleccionado. */
  sessionId: string;
  /** `true` cuando la solicitud pendiente quedó resuelta y debe liberarse. */
  settled: boolean;
  /** La sesión solicitada no existe en la lista fresca. */
  notFound: boolean;
}

/**
 * Resuelve la preselección pedida por `?sessionId`. Mientras la lista no sea fresca (la carga actual no
 * terminó) no se usa la lista en caché: la solicitud queda pendiente y se conserva la selección actual.
 * `sessions` debe ser el resultado de ESA carga cuando `listFresh` es true.
 */
export function resolveGradingSelection(input: {
  sessions: readonly { id: string }[];
  /** Sesión solicitada aún pendiente (undefined: rige la selección manual). */
  pending: number | undefined;
  current: string;
  listFresh: boolean;
}): GradingSelection {
  const { sessions, pending, current, listFresh } = input;
  // Lista fresca vacía: no queda nada que seleccionar (se limpia la selección, también la vigente).
  if (listFresh && sessions.length === 0) {
    return { sessionId: "", settled: true, notFound: pending !== undefined };
  }
  if (pending === undefined) {
    return { sessionId: pickSessionId(sessions, undefined, current), settled: true, notFound: false };
  }
  if (!listFresh) return { sessionId: current, settled: false, notFound: false };
  if (sessions.some((s) => s.id === String(pending))) {
    return { sessionId: String(pending), settled: true, notFound: false };
  }
  return { sessionId: pickSessionId(sessions, undefined, current), settled: true, notFound: true };
}
