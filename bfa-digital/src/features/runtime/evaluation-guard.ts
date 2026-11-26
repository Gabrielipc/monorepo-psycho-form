/**
 * Guarda de vigencia de las respuestas de `/yo` (F2-FIX-4).
 *
 * Toda solicitud de `/yo` recibe, AL INICIAR, un ticket con tres marcas:
 *   - `seq`: orden monotónico de INICIO (no de llegada);
 *   - `visibilityEpoch`: época de visibilidad (se incrementa al ocultar la pestaña);
 *   - `owner`: dueño (asignación + token) con el que salió la solicitud.
 *
 * Una respuesta (dato o error) es vigente solo si su solicitud: (a) nació en la época de visibilidad actual,
 * (b) pertenece al dueño actual y (c) no empezó antes que otra solicitud cuyo resultado ya se aplicó. Una respuesta
 * invalidada no puede adoptar ningún estado (ni pausa, ni bloqueo, ni datos): se descarta.
 *
 * Los resultados se asocian a su ticket por identidad de objeto (WeakMap). Un dato sin ticket (p. ej. una copia
 * derivada por una mutación local) no proviene de una solicitud en vuelo y se considera vigente.
 *
 * F2-FIX-5: el guard es ÚNICO (módulo) y TODA obtención de `/yo` pasa por `fetchEvaluationWithTicket`, incluidos los
 * loaders de las rutas de /evaluacion: ningún /yo en vuelo escapa de la invalidación por visibilidad o por dueño.
 */
import { getEvaluation } from "../../api/endpoints/runtime";
import type { Evaluation } from "../../api/schemas/runtime";
import { useParticipantAuth } from "../../store/participantAuth";

export interface EvaluationRequestTicket {
  readonly seq: number;
  readonly visibilityEpoch: number;
  readonly owner: string;
}

export interface EvaluationGuard {
  /** Reserva el ticket de una solicitud que está por iniciar. */
  startRequest(): EvaluationRequestTicket;
  /** Asocia el resultado (o el error) de una solicitud con su ticket. */
  register(result: object, ticket: EvaluationRequestTicket): void;
  ticketOf(result: unknown): EvaluationRequestTicket | undefined;
  /** Invalida todas las solicitudes iniciadas hasta ahora (ocultación de la pestaña). */
  invalidateForVisibility(): void;
  /** ¿Se puede adoptar el resultado de esta solicitud? Sin ticket → sí. */
  isCurrent(ticket: EvaluationRequestTicket | undefined): boolean;
  /** Registra que el resultado de esta solicitud se aplicó: las que empezaron antes quedan obsoletas. */
  markApplied(ticket: EvaluationRequestTicket | undefined): void;
}

export function createEvaluationGuard(getOwner: () => string): EvaluationGuard {
  let seq = 0;
  let visibilityEpoch = 0;
  let lastAppliedSeq = 0;
  const tickets = new WeakMap<object, EvaluationRequestTicket>();

  return {
    startRequest() {
      seq += 1;
      return { seq, visibilityEpoch, owner: getOwner() };
    },
    register(result, ticket) {
      tickets.set(result, ticket);
    },
    ticketOf(result) {
      return typeof result === "object" && result !== null ? tickets.get(result) : undefined;
    },
    invalidateForVisibility() {
      visibilityEpoch += 1;
    },
    isCurrent(ticket) {
      if (ticket === undefined) return true;
      return (
        ticket.visibilityEpoch === visibilityEpoch &&
        ticket.owner === getOwner() &&
        ticket.seq >= lastAppliedSeq
      );
    },
    markApplied(ticket) {
      if (ticket !== undefined && ticket.seq > lastAppliedSeq) lastAppliedSeq = ticket.seq;
    },
  };
}

/** Guard único del runtime: lo comparten el runner, los loaders de las rutas y el fetcher por defecto de la query. */
export const evaluationGuard: EvaluationGuard = createEvaluationGuard(() => {
  const auth = useParticipantAuth.getState();
  return `${auth.assignmentId ?? ""}:${auth.token ?? ""}`;
});

let visibilityListenerInstalled = false;
/**
 * ÚNICO listener que invalida el ticket al ocultar la pestaña (F2-FIX-6). Lo instalan `fetchEvaluationWithTicket` y el
 * runner (antes de registrar sus propios listeners); el runner NO invalida por su cuenta. Idempotente.
 */
export function ensureVisibilityListener(): void {
  if (visibilityListenerInstalled || typeof document === "undefined") return;
  visibilityListenerInstalled = true;
  // Ocultar la pestaña invalida lo que esté en vuelo aunque todavía no haya un runner montado (loader de la ruta).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") evaluationGuard.invalidateForVisibility();
  });
}

/**
 * ¿El ticket de la solicitud que produjo `data` sigue vigente? (F2-FIX-6) Un loader o `beforeLoad` NUNCA redirige con
 * un /yo cuya solicitud quedó invalidada (ocultación de la pestaña, cambio de dueño, o más vieja que una ya aplicada).
 * Un dato sin ticket (copia local) es vigente.
 */
export function isTicketCurrent(data: unknown): boolean {
  return evaluationGuard.isCurrent(evaluationGuard.ticketOf(data));
}

/**
 * ÚNICA vía de obtención de `/yo` (F2-FIX-5): toma el ticket al INICIAR y lo asocia al resultado o al error.
 */
export async function fetchEvaluationWithTicket(): Promise<Evaluation> {
  ensureVisibilityListener();
  const ticket = evaluationGuard.startRequest();
  try {
    const evaluation = await getEvaluation();
    evaluationGuard.register(evaluation, ticket);
    return evaluation;
  } catch (err) {
    if (typeof err === "object" && err !== null) evaluationGuard.register(err, ticket);
    throw err;
  }
}
