import { participantClient } from "./client";
import { ApiError } from "./errors";
import { useParticipantAuth } from "../store/participantAuth";
import { useEvaluationStore, type QueuedAnswer, type RejectedAnswer } from "../store/evaluationStore";
import {
  getItemsFromPayload,
  normalizeParticipantEvaluation,
  normalizeParticipantItem,
  parseParticipantAccessCode,
  ParticipantEvaluationAccessDTO,
  ParticipantItemDTO,
  resolveSubtestBySlug,
  sortItemsByOrdinal,
} from "./participantMappers";
import {
  ParticipantAccessRequest,
  ParticipantAccessResponse,
  StartAttemptRequest,
  SaveAnswerRequest,
  FinishRequest,
  ApiResponse,
} from "./types";

export type { ParticipantEvaluationAccessDTO, ParticipantItemDTO } from "./participantMappers";

const toNumericId = (value: string, label: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} invalido: ${value}`);
  }
  return parsed;
};

const getApiMessage = (error: unknown, fallback: string): string => {
  const candidate = error as {
    response?: { data?: { message?: string; error?: { message?: string } } };
    message?: string;
  };

  return candidate.response?.data?.message ||
    candidate.response?.data?.error?.message ||
    candidate.message ||
    fallback;
};

const warnDiscarded = (count: number, reason: string): void => {
  if (import.meta.env.DEV && count > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[evaluation] ${count} respuesta(s) encolada(s) descartada(s): ${reason}`);
  }
};

/**
 * Deja en la cola solo las entradas del participante e intento actuales y descarta
 * (con warn en DEV) las ajenas. Una entrada encolada antes de existir el intento
 * (attemptId null) de la misma asignación se adopta al intento actual.
 */
const pruneForeignQueue = (): QueuedAnswer[] => {
  const store = useEvaluationStore.getState();
  const owner = store.ownerAssignmentId;
  const currentAttemptId = store.attemptId;

  let discarded = 0;
  let adopted = false;
  const kept: QueuedAnswer[] = [];
  for (const entry of store.syncQueue) {
    // Entradas legacy (sin assignmentId) o de otra asignación: ajenas.
    if (owner === null || entry.assignmentId !== owner) {
      discarded += 1;
      continue;
    }
    if (entry.attemptId === null) {
      if (currentAttemptId !== null) {
        kept.push({ ...entry, attemptId: currentAttemptId });
        adopted = true;
      } else {
        kept.push(entry);
      }
      continue;
    }
    if (entry.attemptId !== currentAttemptId) {
      discarded += 1;
      continue;
    }
    kept.push(entry);
  }

  if (discarded > 0 || adopted) {
    warnDiscarded(discarded, "pertenecen a otro participante o intento");
    store.setQueue(kept);
  }
  return kept;
};

/** Payload del backend: sin los campos internos de propiedad (assignmentId/attemptId). */
const toSaveAnswerRequest = ({ itemId, selectedOptionIds, textAnswer, numericAnswer, timeUsedSeconds }: QueuedAnswer): SaveAnswerRequest => ({
  itemId,
  selectedOptionIds,
  ...(textAnswer !== undefined ? { textAnswer } : {}),
  ...(numericAnswer !== undefined ? { numericAnswer } : {}),
  ...(timeUsedSeconds !== undefined ? { timeUsedSeconds } : {}),
});

// ---------------------------------------------------------------------------
// Propiedad de la sesión del runner: respuestas tardías.
// ---------------------------------------------------------------------------

/** Código de `ApiError` con que se rechaza una respuesta que llegó cuando ya hay otro participante/intento. */
export const STALE_PARTICIPANT = "STALE_PARTICIPANT";

interface ParticipantOwner {
  assignmentId: number | null;
  attemptId: number | null;
}

/** Dueño actual del estado del runner (asignación + intento). */
const captureOwner = (): ParticipantOwner => {
  const { ownerAssignmentId, ownerAttemptId } = useEvaluationStore.getState();
  return { assignmentId: ownerAssignmentId, attemptId: ownerAttemptId };
};

/**
 * ¿Sigue siendo el dueño capturado? La asignación debe coincidir. El intento solo se exige si
 * ya existía al capturar: pasar de "sin intento" a "con intento" (lo crea la propia operación
 * o una concurrente de la misma asignación) no es un cambio de dueño.
 */
const isSameOwner = (owner: ParticipantOwner): boolean => {
  const current = captureOwner();
  if (current.assignmentId !== owner.assignmentId) return false;
  return owner.attemptId === null || current.attemptId === owner.attemptId;
};

const staleError = (): ApiError =>
  new ApiError({
    status: 0,
    code: STALE_PARTICIPANT,
    message: "La respuesta pertenece a un participante o intento anterior y se descartó.",
  });

/** Lanza `STALE_PARTICIPANT` si el dueño cambió mientras vuelaba una petición. Se llama ANTES de escribir en los stores. */
const assertSameOwner = (owner: ParticipantOwner): void => {
  if (!isSameOwner(owner)) throw staleError();
};

export const isStaleParticipantError = (error: unknown): boolean =>
  error instanceof ApiError && error.code === STALE_PARTICIPANT;

/** Última asignación cuyo acceso se pidió: una validación de otra asignación más antigua queda obsoleta. */
let latestValidatingAssignmentId: number | null = null;

// ---------------------------------------------------------------------------
// bulk-sync: resultado por ítem y serialización de envíos.
// ---------------------------------------------------------------------------

/**
 * Motivos de rechazo reales de `POST /intentos/{id}/respuestas/bulk-sync` (HTTP 200 con un
 * resultado por ítem `{ itemId, status: "GUARDADA" | "RECHAZADA", code, answerId }`; ver
 * `ParticipantAnswerService.bulkSyncAnswers`, `ParticipantConflictException` y las constantes
 * `SUBTEST_NO_INICIADO`, `SUBTEST_FINALIZADO`, `ITEM_NO_ENCONTRADO`, `OPCION_INVALIDA`,
 * `RESPUESTA_INVALIDA` y `TIEMPO_AGOTADO`; el backend no emite ningún otro código por ítem):
 * - `SUBTEST_FINALIZADO`: el subtest ya se cerró. Definitivo: reenviar nunca lo aceptará.
 * - `TIEMPO_AGOTADO`: se agotó el tiempo del subtest (el backend lo cierra). Definitivo.
 * - `ITEM_NO_ENCONTRADO`: el ítem no existe. Definitivo.
 * - `OPCION_INVALIDA`: alguna opción no existe o no pertenece al ítem. Definitivo.
 * - `RESPUESTA_INVALIDA`: la respuesta es incompatible con el tipo del ítem. Definitivo.
 * - `SUBTEST_NO_INICIADO`: el subtest aún no se inició en el backend. Transitorio: se aceptará
 *   cuando se inicie, así que la respuesta se conserva en la cola.
 * Un código desconocido se trata como transitorio (nunca se descarta lo que no se entiende).
 */
const BULK_REJECTION_REASONS: Record<string, { definitive: boolean; reason: string }> = {
  SUBTEST_FINALIZADO: { definitive: true, reason: "El subtest ya fue finalizado." },
  TIEMPO_AGOTADO: { definitive: true, reason: "El tiempo del subtest se agotó." },
  ITEM_NO_ENCONTRADO: { definitive: true, reason: "El ítem no existe." },
  OPCION_INVALIDA: { definitive: true, reason: "La opción seleccionada no es válida para el ítem." },
  RESPUESTA_INVALIDA: { definitive: true, reason: "La respuesta no es compatible con el tipo del ítem." },
  SUBTEST_NO_INICIADO: { definitive: false, reason: "El subtest aún no fue iniciado." },
};

interface BulkSyncItemResult {
  status: string;
  code: string | null;
}

/** Indexa por `itemId` el cuerpo de bulk-sync; todo lo que no tenga la forma esperada se ignora (= no confirmado). */
const parseBulkSyncResults = (payload: unknown): Map<number, BulkSyncItemResult> => {
  const results = new Map<number, BulkSyncItemResult>();
  if (!Array.isArray(payload)) return results;
  for (const raw of payload) {
    if (typeof raw !== "object" || raw === null) continue;
    const { itemId, status, code } = raw as Record<string, unknown>;
    if (typeof itemId !== "number" || typeof status !== "string") continue;
    results.set(itemId, { status, code: typeof code === "string" ? code : null });
  }
  return results;
};

/** PUT directos en vuelo por ítem: una versión posterior del mismo ítem espera a que terminen. */
const inFlightPuts = new Map<number, Promise<void>>();

let inFlightSync: Promise<void> | null = null;
let nextSync: Promise<void> | null = null;

/**
 * Serializa los envíos: nunca hay dos bulk-sync a la vez (evento `online` + intervalo). Como
 * máximo hay uno en vuelo y uno en espera; las llamadas que llegan mientras tanto comparten el
 * pendiente, que arranca al terminar el actual y ve la cola ya actualizada.
 */
const runSerializedSync = (job: () => Promise<void>): Promise<void> => {
  if (inFlightSync === null) {
    const run: Promise<void> = job().finally(() => {
      if (inFlightSync === run) inFlightSync = null;
    });
    inFlightSync = run;
    return run;
  }
  if (nextSync === null) {
    nextSync = inFlightSync
      .catch(() => undefined)
      .then(() => {
        nextSync = null;
        return runSerializedSync(job);
      });
  }
  return nextSync;
};

/** Un envío de la cola. Nunca rechaza: ante cualquier fallo marca offline y deja la cola intacta. */
const syncOnce = async (): Promise<void> => {
  const store = useEvaluationStore.getState();

  if (!store.syncQueue || store.syncQueue.length === 0) {
    store.setOffline(false);
    return;
  }

  const owner = captureOwner();
  // Lo ajeno se descarta antes de cualquier petición (incluida la creación del intento).
  if (pruneForeignQueue().length === 0) {
    store.setOffline(false);
    return;
  }

  try {
    const attemptId = await participantService.getOrCreateAttemptId();
    assertSameOwner(owner); // cambió el participante mientras se creaba el intento

    // Solo se envía lo que pertenece al intento actual; lo ajeno se descarta.
    const owned = pruneForeignQueue();
    // Un ítem con PUT directo en vuelo se deja en la cola: si el POST guardara antes que el PUT, la
    // selección vieja del PUT ganaría. Se reintenta cuando ese PUT termine.
    const toSend = owned.filter((entry) => !inFlightPuts.has(entry.itemId));
    if (toSend.length < owned.length) {
      const pending = owned.filter((entry) => inFlightPuts.has(entry.itemId)).map((entry) => inFlightPuts.get(entry.itemId));
      void Promise.all(pending).then(() => runSerializedSync(syncOnce));
    }
    if (toSend.length === 0) {
      if (owned.length === 0) useEvaluationStore.getState().setOffline(false);
      return;
    }

    const response = await participantClient.post<ApiResponse<unknown>>(
      `/intentos/${attemptId}/respuestas/bulk-sync`,
      toSend.map(toSaveAnswerRequest),
    );
    assertSameOwner(owner); // la respuesta es de otro participante: no se toca el store

    // HTTP 200 NO significa "todo guardado": cada ítem trae su propio resultado.
    const results = parseBulkSyncResults(response.data?.data);
    const settled: QueuedAnswer[] = [];
    const rejected: RejectedAnswer[] = [];
    for (const entry of toSend) {
      const result = results.get(entry.itemId);
      if (!result) continue; // sin confirmación: se conserva
      if (result.status === "GUARDADA") {
        settled.push(entry);
      } else if (result.status === "RECHAZADA") {
        const meta = result.code ? BULK_REJECTION_REASONS[result.code] : undefined;
        if (meta?.definitive && result.code) {
          settled.push(entry);
          rejected.push({
            itemId: entry.itemId,
            assignmentId: entry.assignmentId,
            attemptId: entry.attemptId,
            code: result.code,
            reason: meta.reason,
            rejectedAt: new Date().toISOString(),
          });
        }
        // Transitorio o desconocido: se conserva para reintentar.
      }
    }

    const current = useEvaluationStore.getState();
    current.addRejectedAnswers(rejected);
    // La cola pudo cambiar durante el envío: se quitan solo las entradas ya resueltas (por referencia).
    current.removeFromQueue(settled);
    warnDiscarded(rejected.length, "el backend las rechazó de forma definitiva (ver rejectedAnswers)");
    current.setOffline(false); // el backend respondió: hay conexión aunque queden pendientes
  } catch (error: unknown) {
    if (isStaleParticipantError(error)) return;
    // Un rechazo tardío (p. ej. 503) de otro participante no marca offline al actual.
    if (!isSameOwner(owner)) return;
    useEvaluationStore.getState().setOffline(true);
  }
};

export const participantService = {
  async validateAccess(tokenInput: string): Promise<ParticipantEvaluationAccessDTO> {
    try {
      const { assignmentId, token } = parseParticipantAccessCode(tokenInput);
      const startOwner = captureOwner();
      // Una validación de OTRA asignación pedida después deja obsoleta a esta (la de la misma
      // asignación —p. ej. un efecto duplicado— no: ambas escribirían lo mismo).
      latestValidatingAssignmentId = assignmentId;
      const isSuperseded = (): boolean => latestValidatingAssignmentId !== assignmentId;

      const accessResponse = await participantClient.post<ApiResponse<ParticipantAccessResponse>>(
        "/acceso-participante/validar",
        { assignmentId, token } as ParticipantAccessRequest,
      );

      const accessResult = accessResponse.data.data;

      // Obsoleta, o el estado pasó a manos de un tercero (ni el dueño con el que empezó ni este acceso).
      const ownerNow = captureOwner().assignmentId;
      if (isSuperseded() || (ownerNow !== startOwner.assignmentId && ownerNow !== accessResult.assignmentId)) {
        throw staleError();
      }

      // Otro participante (o primer acceso): se descarta TODO el estado local del anterior
      // (respuestas, cola offline, intento) antes de guardar datos nuevos.
      if (useEvaluationStore.getState().ownerAssignmentId !== accessResult.assignmentId) {
        useEvaluationStore.getState().clearStore();
      }
      useEvaluationStore.getState().setOwner(accessResult.assignmentId);

      useParticipantAuth.getState().setSession({
        token: accessResult.accessToken,
        assignmentId: accessResult.assignmentId,
      });

      // Token explícito: la petición no depende de lo que haya en el store cuando se envíe.
      const meResponse = await participantClient.get<ApiResponse<unknown>>("/evaluacion-participante/yo", {
        headers: { Authorization: `Bearer ${accessResult.accessToken}` },
      });
      // Si mientras tanto se validó otro participante, NO se escribe su intento en el estado del nuevo.
      if (isSuperseded() || captureOwner().assignmentId !== accessResult.assignmentId) throw staleError();

      const meData = meResponse.data.data;
      const normalized = normalizeParticipantEvaluation(meData, accessResult.assignmentId);

      const attemptRecord = meData && typeof meData === "object" ? meData as Record<string, unknown> : {};
      const attemptId = Number(
        attemptRecord.attemptId ??
        attemptRecord.intentoId ??
        attemptRecord.id,
      );
      if (Number.isInteger(attemptId) && attemptId > 0) {
        useEvaluationStore.getState().setAttemptId(attemptId);
      } else {
        useEvaluationStore.getState().setAttemptId(null);
      }

      return {
        ...normalized,
        assignmentId: String(accessResult.assignmentId),
      };
    } catch (error: unknown) {
      if (isStaleParticipantError(error)) throw error;
      const status = (error as { response?: { status?: number } }).response?.status || 500;
      throw {
        status,
        message: getApiMessage(error, "Codigo de acceso invalido o error del servidor."),
      };
    }
  },

  async getOrCreateAttemptId(): Promise<number> {
    let attemptId = useEvaluationStore.getState().attemptId;
    if (!attemptId) {
      const owner = captureOwner();
      const accessData = useEvaluationStore.getState().accessData;
      if (accessData?.assignmentId) {
        const attemptResponse = await participantClient.post<ApiResponse<unknown>>(
          "/evaluacion-participante/iniciar",
          {
            assignmentId: toNumericId(accessData.assignmentId, "assignmentId"),
            deviceInfo: "Browser",
          } as StartAttemptRequest,
        );
        // Inicio tardío: si ya hay otro participante, el intento creado NO se guarda en su estado.
        assertSameOwner(owner);
        const existing = useEvaluationStore.getState().attemptId;
        if (existing) return existing; // una operación concurrente de esta asignación ya lo guardó
        const attempt = attemptResponse.data.data as Record<string, unknown>;
        attemptId = Number(attempt?.id ?? attempt?.attemptId ?? attempt?.intentoId);
        if (Number.isInteger(attemptId) && attemptId > 0) {
          useEvaluationStore.getState().setAttemptId(attemptId);
        }
      }
    }
    if (!attemptId) {
      throw new Error("No active attempt ID found");
    }
    return attemptId;
  },

  async startAttempt(assignmentId: number, deviceInfo: string = "Browser"): Promise<number> {
    const owner = captureOwner();
    const response = await participantClient.post<ApiResponse<unknown>>(
      "/evaluacion-participante/iniciar",
      { assignmentId, deviceInfo } as StartAttemptRequest,
    );
    assertSameOwner(owner);
    const attempt = response.data.data as Record<string, unknown>;
    return Number(attempt?.id ?? attempt?.attemptId ?? attempt?.intentoId);
  },

  async startSubtest(_token: string, subtestSlug: string): Promise<void> {
    const owner = captureOwner();
    const attemptId = await this.getOrCreateAttemptId();
    assertSameOwner(owner);
    const accessData = useEvaluationStore.getState().accessData;
    const subtest = resolveSubtestBySlug(accessData, subtestSlug);

    await participantClient.post(`/intentos/${attemptId}/subtests/${toNumericId(subtest.id, "subtestId")}/iniciar`);
    assertSameOwner(owner);
  },

  async getItem(_token: string, subtestSlug: string, itemRouteId: string): Promise<ParticipantItemDTO> {
    const owner = captureOwner();
    const attemptId = await this.getOrCreateAttemptId();
    assertSameOwner(owner);
    const accessData = useEvaluationStore.getState().accessData;
    const subtest = resolveSubtestBySlug(accessData, subtestSlug);

    const response = await participantClient.get<ApiResponse<unknown>>(
      `/intentos/${attemptId}/subtests/${toNumericId(subtest.id, "subtestId")}/items`,
    );
    // Un ítem de otro participante nunca se entrega a la pantalla del actual.
    assertSameOwner(owner);
    const items = sortItemsByOrdinal(getItemsFromPayload(response.data.data));
    const ordinal = Number(itemRouteId.replace("it-", "")) || 1;
    const rawItem = items[ordinal - 1];

    if (!rawItem) {
      throw new Error(`Reactivo no encontrado: ${itemRouteId}`);
    }

    return normalizeParticipantItem(rawItem, subtestSlug);
  },

  async saveAnswer(_token: string, _subtestSlug: string, itemIdStr: string, optionIdStr: string): Promise<void> {
    const itemId = toNumericId(itemIdStr, "itemId");
    const optionId = toNumericId(optionIdStr, "optionId");

    const owner = captureOwner();
    const ownerAssignmentId = owner.assignmentId ?? useParticipantAuth.getState().assignmentId;
    if (ownerAssignmentId === null) {
      throw new Error("No hay un participante validado para guardar la respuesta.");
    }

    const answerRequest: SaveAnswerRequest = {
      itemId,
      selectedOptionIds: [optionId],
      timeUsedSeconds: 1,
    };
    const toQueued = (attemptId: number | null): QueuedAnswer => ({
      ...answerRequest,
      assignmentId: ownerAssignmentId,
      attemptId,
    });
    const hasQueuedVersion = (): boolean =>
      useEvaluationStore.getState().syncQueue.some((entry) => entry.itemId === itemId);

    pruneForeignQueue();

    if (!navigator.onLine || useEvaluationStore.getState().isOffline) {
      const current = useEvaluationStore.getState();
      current.addToQueue(toQueued(current.attemptId));
      current.setOffline(true);
      return;
    }

    // Orden por ítem: si ya hay una versión anterior en la cola (o en un bulk-sync en vuelo: sus
    // entradas siguen en la cola hasta confirmarse) o un PUT directo en vuelo, un PUT directo
    // podría adelantarse y luego ser pisado por la versión vieja. La nueva versión REEMPLAZA a la
    // anterior en la cola (deduplica por itemId) y sale por el envío serializado.
    const priorPut = inFlightPuts.get(itemId);
    if (hasQueuedVersion() || priorPut) {
      const current = useEvaluationStore.getState();
      current.addToQueue(toQueued(current.attemptId));
      if (priorPut) await priorPut; // no se lanza el lote por delante de un PUT del mismo ítem
      await runSerializedSync(syncOnce);
      return;
    }

    const direct = (async (): Promise<void> => {
      try {
        const attemptId = await this.getOrCreateAttemptId();
        // Se validó otro participante mientras tanto: esta respuesta ya no le corresponde al intento actual.
        assertSameOwner(owner);
        await participantClient.put(`/intentos/${attemptId}/items/${itemId}/respuesta`, answerRequest);
        // Una confirmación tardía de otro participante no toca los flags del actual.
        assertSameOwner(owner);
        useEvaluationStore.getState().setOffline(false);
      } catch (error: unknown) {
        if (isStaleParticipantError(error)) {
          warnDiscarded(1, "el participante cambió durante el guardado");
          return;
        }
        const candidate = error as { code?: string; response?: unknown };
        const isNetworkError = candidate.code === "ERR_NETWORK" || !candidate.response;
        if (!isNetworkError) throw error;
        if (!isSameOwner(owner)) {
          warnDiscarded(1, "el participante cambió durante el guardado");
          return;
        }
        const current = useEvaluationStore.getState();
        // Si mientras volaba se encoló una versión más nueva de este ítem, esa gana: no se pisa con la vieja.
        if (!hasQueuedVersion()) current.addToQueue(toQueued(current.attemptId));
        current.setOffline(true);
      }
    })();

    const tracked = direct.then(
      () => undefined,
      () => undefined,
    );
    inFlightPuts.set(itemId, tracked);
    try {
      await direct;
    } finally {
      if (inFlightPuts.get(itemId) === tracked) inFlightPuts.delete(itemId);
    }
  },

  /**
   * Envía la cola offline. Serializado (un solo bulk-sync a la vez) y por resultado: solo se
   * retiran las respuestas confirmadas `GUARDADA` o rechazadas de forma definitiva (estas pasan
   * a `evaluationStore.rejectedAnswers` con su motivo); el resto se conserva para reintentar.
   */
  syncPendingAnswers(_token: string): Promise<void> {
    return runSerializedSync(syncOnce);
  },

  async finishSubtest(_token: string, subtestSlug: string, timeUsedSeconds: number = 0): Promise<void> {
    const owner = captureOwner();
    const attemptId = await this.getOrCreateAttemptId();
    assertSameOwner(owner);
    const accessData = useEvaluationStore.getState().accessData;
    const subtest = resolveSubtestBySlug(accessData, subtestSlug);

    await participantClient.post(
      `/intentos/${attemptId}/subtests/${toNumericId(subtest.id, "subtestId")}/finalizar`,
      { timeSeconds: timeUsedSeconds } as FinishRequest,
    );
    assertSameOwner(owner);
  },

  async finishEvaluation(_token: string, timeUsedSeconds: number = 0): Promise<void> {
    const owner = captureOwner();
    const attemptId = await this.getOrCreateAttemptId();
    assertSameOwner(owner);
    await participantClient.post(`/intentos/${attemptId}/finalizar`, {
      timeSeconds: timeUsedSeconds,
    } as FinishRequest);
    assertSameOwner(owner);
  },
};
