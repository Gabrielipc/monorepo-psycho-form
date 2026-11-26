import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import {
  finishAttempt,
  finishSubtest,
  isRuntimeBlocked,
  startAttempt,
  startSubtest,
} from "../../api/endpoints/runtime";
import { ApiError } from "../../api/errors";
import type {
  Evaluation,
  RuntimeErrorCode,
  RuntimeItem,
  RuntimeSubtest,
  SubtestAttempt,
} from "../../api/schemas/runtime";
import { RUNTIME_ERROR_CODES } from "../../api/schemas/runtime";
import { useParticipantAuth } from "../../store/participantAuth";
import { fromSavedAnswer, type AnswerValue } from "./answer-value";
import {
  bindDraftOwner,
  clearRuntimeDraft,
  flush,
  flushBeforeFinish,
  isStaleParticipantError,
  resumeSync,
  setAnswer,
  useRuntimeDraft,
  useSyncStatus,
} from "./draft";
import {
  INITIAL_STATE,
  clampOrdinal,
  findSubtest,
  isResumable,
  isSubtestOpenable,
  isTerminal,
  isValidOrdinal,
  remainingMs,
  runnerReducer,
  startSubtestOkEvent,
  type FinishReason,
  type RunnerState,
} from "./machine";
import { evaluationQueryOptions, runtimeKeys, subtestItemsQueryOptions } from "./queries";

const DEFAULT_POLLING_INTERVAL_MS = 10_000;
const RUNTIME_ERROR_SET: ReadonlySet<string> = new Set(RUNTIME_ERROR_CODES);

function isAuthRevokedCode(code: string): boolean {
  return code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "HTTP_401" || code === "HTTP_403";
}

function withUpdatedSubtest(
  evaluation: Evaluation,
  subtestId: number,
  updater: (subtest: RuntimeSubtest) => RuntimeSubtest,
): Evaluation {
  return {
    ...evaluation,
    subtests: evaluation.subtests.map((s) => (s.id === subtestId ? updater(s) : s)),
  };
}

function mergeTimingFromAttempt(
  existing: RuntimeSubtest["timing"],
  attempt: SubtestAttempt,
): RuntimeSubtest["timing"] {
  const merged: NonNullable<RuntimeSubtest["timing"]> = {
    ...existing,
    ...attempt.timing,
    ...(attempt.startedAt !== undefined ? { startedAt: attempt.startedAt } : {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function seedAttemptStartMs(evaluation: Evaluation): number | null {
  let earliest: number | null = null;
  for (const subtest of evaluation.subtests) {
    const startedAt = subtest.timing?.startedAt;
    if (!startedAt) continue;
    const ms = Date.parse(startedAt);
    if (!Number.isFinite(ms)) continue;
    const serverNowMs = subtest.timing?.serverNow ? Date.parse(subtest.timing.serverNow) : Number.NaN;
    const adjusted = Number.isFinite(serverNowMs) ? ms + (Date.now() - serverNowMs) : ms;
    if (earliest === null || adjusted < earliest) {
      earliest = adjusted;
    }
  }
  return earliest;
}

export interface RunnerContextValue {
  state: RunnerState;
  evaluation: Evaluation | null;
  assignmentId: number | null;
  nowMs: number;
  remainingTimeMs: number | null;
  evaluationError: unknown;
  refetchEvaluation: () => void;
  isStartingAttempt: boolean;
  isStartingSubtest: boolean;
  isFinishingSubtest: boolean;
  isFinishingAttempt: boolean;
  actionError: string | null;
  clearActionError: () => void;
  startAttemptAction: () => Promise<boolean>;
  openSubtestAction: (subtestId: number) => void;
  backToListAction: () => void;
  startSubtestAction: (subtestId: number) => Promise<number | null>;
  goToItemAction: (ordinal: number) => void;
  finishSubtestAction: (subtestId: number, reason?: FinishReason) => Promise<boolean>;
  finishAttemptAction: () => Promise<boolean>;
  ensureInstructionsRoute: (subtestId: number) => void;
  ensureItemsRoute: (subtestId: number, ordinal: number) => Promise<void>;
  getItemValue: (item: RuntimeItem) => AnswerValue | undefined;
  saveItemValue: (item: RuntimeItem, subtestId: number, value: AnswerValue) => Promise<void>;
  setActiveItem: (item: RuntimeItem | null, subtestId: number | null) => void;
}

const RunnerContext = createContext<RunnerContextValue | null>(null);

export interface RunnerProviderProps {
  children: ReactNode;
  /** Intervalo de polling de `/yo` (ms). 0 desactiva el polling (útil en tests). */
  pollingIntervalMs?: number;
}

export function RunnerProvider({
  children,
  pollingIntervalMs = DEFAULT_POLLING_INTERVAL_MS,
}: RunnerProviderProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const assignmentId = useParticipantAuth((s) => s.assignmentId);
  const token = useParticipantAuth((s) => s.token);
  const draftAnswers = useRuntimeDraft((s) => s.answers);
  const syncStatus = useSyncStatus();

  const [state, dispatch] = useReducer(runnerReducer, INITIAL_STATE);
  const stateRef = useRef(state);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isStartingAttempt, setIsStartingAttempt] = useState(false);
  const [isStartingSubtest, setIsStartingSubtest] = useState(false);
  const [isFinishingSubtest, setIsFinishingSubtest] = useState(false);
  const [isFinishingAttempt, setIsFinishingAttempt] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Seguimiento de tiempos reales (ítems, subtests, intento)
  const activeItemRef = useRef<{ itemId: number; subtestId: number } | null>(null);
  const itemEnteredAtRef = useRef<number | null>(null);
  const itemAccumulatedMsRef = useRef<Map<number, number>>(new Map());

  const subtestEnteredAtRef = useRef<{ subtestId: number; at: number } | null>(null);
  const subtestAccumulatedMsRef = useRef<Map<number, number>>(new Map());

  const attemptAccumulatedMsRef = useRef<number>(0);
  const attemptResumedAtRef = useRef<number | null>(null);
  const attemptSeededRef = useRef<number | null>(null);

  const finishingSubtestRef = useRef<number | null>(null);
  const deadlineFiredKeyRef = useRef<string | null>(null);
  const loadingItemsForRef = useRef<number | null>(null);

  const flushActiveItemMs = useCallback((now: number, keepRunning: boolean) => {
    const active = activeItemRef.current;
    const enteredAt = itemEnteredAtRef.current;
    if (active !== null && enteredAt !== null) {
      const elapsed = Math.max(0, now - enteredAt);
      const prev = itemAccumulatedMsRef.current.get(active.itemId) ?? 0;
      itemAccumulatedMsRef.current.set(active.itemId, prev + elapsed);
      itemEnteredAtRef.current = keepRunning ? now : null;
    } else if (!keepRunning) {
      itemEnteredAtRef.current = null;
    }
  }, []);

  const flushActiveSubtestMs = useCallback((now: number, keepRunning: boolean) => {
    const active = subtestEnteredAtRef.current;
    if (active !== null) {
      const elapsed = Math.max(0, now - active.at);
      const prev = subtestAccumulatedMsRef.current.get(active.subtestId) ?? 0;
      subtestAccumulatedMsRef.current.set(active.subtestId, prev + elapsed);
      subtestEnteredAtRef.current = keepRunning ? { subtestId: active.subtestId, at: now } : null;
    }
  }, []);

  const flushAttemptMs = useCallback((now: number, keepRunning: boolean) => {
    if (attemptResumedAtRef.current !== null) {
      attemptAccumulatedMsRef.current += Math.max(0, now - attemptResumedAtRef.current);
      attemptResumedAtRef.current = keepRunning ? now : null;
    }
  }, []);

  const evaluationQuery = useQuery({
    ...evaluationQueryOptions(assignmentId ?? 0),
    enabled: assignmentId !== null && Boolean(token),
    refetchInterval: (query) => {
      if (pollingIntervalMs <= 0) return false;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
      if (isTerminal(stateRef.current)) return false;
      const data = query.state.data;
      if (data && (data.attemptStatus === "COMPLETADO" || data.attemptStatus === "ANULADO")) {
        return false;
      }
      return pollingIntervalMs;
    },
  });
  const { refetch: refetchEvaluationQuery } = evaluationQuery;

  const currentEvaluation = useMemo(() => {
    switch (state.kind) {
      case "validando":
        return null;
      case "pausada":
        return state.resumeTo.evaluation;
      default:
        return state.evaluation;
    }
  }, [state]);

  const currentEvalRef = useRef<Evaluation | null>(currentEvaluation);
  useEffect(() => {
    stateRef.current = state;
    currentEvalRef.current = currentEvaluation;
  }, [state, currentEvaluation]);

  const isOwnerActive = useCallback(
    (capturedAssignmentId: number, capturedAttemptId?: number | null): boolean => {
      if (!mountedRef.current) return false;
      const auth = useParticipantAuth.getState();
      if (auth.assignmentId !== capturedAssignmentId || !auth.token) return false;
      if (capturedAttemptId !== undefined && capturedAttemptId !== null) {
        const liveAttemptId = currentEvalRef.current?.attemptId;
        if (liveAttemptId !== undefined && liveAttemptId !== null && liveAttemptId !== capturedAttemptId) {
          return false;
        }
      }
      return true;
    },
    [],
  );

  // Sincroniza query /yo -> bindDraftOwner -> EVALUATION_LOADED
  const lastProcessedDataUpdatedAtRef = useRef<number>(0);
  useEffect(() => {
    const data = evaluationQuery.data;
    if (!data || assignmentId === null) return;
    if (data.assignmentId !== assignmentId) return;
    if (evaluationQuery.dataUpdatedAt === lastProcessedDataUpdatedAtRef.current) return;
    lastProcessedDataUpdatedAtRef.current = evaluationQuery.dataUpdatedAt;

    if (data.attemptId !== null) {
      bindDraftOwner({ assignmentId: data.assignmentId, attemptId: data.attemptId });
      if (attemptSeededRef.current !== data.attemptId) {
        attemptSeededRef.current = data.attemptId;
        const seededStart = seedAttemptStartMs(data);
        attemptAccumulatedMsRef.current =
          seededStart !== null ? Math.max(0, Date.now() - seededStart) : 0;
        attemptResumedAtRef.current = data.sessionStatus === "PAUSADA" ? null : Date.now();
      }
    }

    if (!isTerminal(stateRef.current)) {
      dispatch({ type: "EVALUATION_LOADED", evaluation: data, clientNow: Date.now() });
    }
  }, [assignmentId, evaluationQuery.data, evaluationQuery.dataUpdatedAt]);

  // Refetch al volver la pestaña a visible si está activa
  useEffect(() => {
    if (pollingIntervalMs <= 0 || typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !isTerminal(stateRef.current)) {
        void refetchEvaluationQuery();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pollingIntervalMs, refetchEvaluationQuery]);

  // Errores de carga/polling de /yo
  const lastProcessedErrorAtRef = useRef<number>(0);
  useEffect(() => {
    const err = evaluationQuery.error;
    if (!err || !evaluationQuery.isError) return;
    if (evaluationQuery.errorUpdatedAt === lastProcessedErrorAtRef.current) return;
    lastProcessedErrorAtRef.current = evaluationQuery.errorUpdatedAt;

    if (isStaleParticipantError(err)) return;
    if (isRuntimeBlocked(err)) {
      if (err.code === "SESION_PAUSADA" && stateRef.current.kind === "pausada") return;
      dispatch({ type: "SERVER_ERROR", code: err.code as RuntimeErrorCode, clientNow: Date.now() });
      return;
    }
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      dispatch({ type: "ACCESS_REVOKED" });
    }
  }, [evaluationQuery.error, evaluationQuery.errorUpdatedAt, evaluationQuery.isError]);

  // Observa useSyncStatus() para pausa / bloqueo / revocación desde la cola de respuestas
  const lastSyncBlockCodeRef = useRef<string | null>(null);
  useEffect(() => {
    const code = syncStatus.blockedCode;
    if (code === lastSyncBlockCodeRef.current) return;
    lastSyncBlockCodeRef.current = code;
    if (!code) return;

    if (isAuthRevokedCode(code)) {
      dispatch({ type: "ACCESS_REVOKED" });
      return;
    }
    if (RUNTIME_ERROR_SET.has(code)) {
      if (code === "SESION_PAUSADA" && stateRef.current.kind === "pausada") return;
      if (isResumable(stateRef.current) || code !== "SESION_PAUSADA") {
        dispatch({ type: "SERVER_ERROR", code: code as RuntimeErrorCode, clientNow: Date.now() });
      }
    }
  }, [syncStatus.blockedCode]);

  // Transiciones laterales: salida de pausa -> resumeSync(); completada -> clearRuntimeDraft()
  const prevStateKindRef = useRef(state.kind);
  useEffect(() => {
    const prevKind = prevStateKindRef.current;
    prevStateKindRef.current = state.kind;

    const now = Date.now();
    if (prevKind === "pausada" && state.kind !== "pausada" && !isTerminal(state)) {
      void resumeSync();
    }

    if (state.kind === "completada") {
      clearRuntimeDraft();
      flushActiveItemMs(now, false);
      flushActiveSubtestMs(now, false);
      flushAttemptMs(now, false);
      return;
    }

    if (state.kind === "bloqueado") {
      flushActiveItemMs(now, false);
      flushActiveSubtestMs(now, false);
      flushAttemptMs(now, false);
      return;
    }

    if (state.kind === "pausada") {
      flushActiveItemMs(now, false);
      flushActiveSubtestMs(now, false);
      flushAttemptMs(now, false);
      return;
    }

    // Estado activo no pausado
    if (currentEvalRef.current?.attemptId !== null && attemptResumedAtRef.current === null) {
      attemptResumedAtRef.current = now;
    }

    if (state.kind === "respondiendo" && !state.timing.paused) {
      if (activeItemRef.current !== null && itemEnteredAtRef.current === null) {
        itemEnteredAtRef.current = now;
      }
      if (
        subtestEnteredAtRef.current === null ||
        subtestEnteredAtRef.current.subtestId !== state.subtestId
      ) {
        flushActiveSubtestMs(now, false);
        subtestEnteredAtRef.current = { subtestId: state.subtestId, at: now };
      }
    } else {
      flushActiveItemMs(now, false);
      flushActiveSubtestMs(now, false);
    }
  }, [state, flushActiveItemMs, flushActiveSubtestMs, flushAttemptMs]);

  // Tick de 1s mientras respondiendo y no pausado
  const isTimerRunning = state.kind === "respondiendo" && !state.timing.paused;
  useEffect(() => {
    if (!isTimerRunning) return;
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(id);
  }, [isTimerRunning]);

  const computeSubtestSeconds = useCallback(
    (subtestId: number, now: number): number => {
      const s = stateRef.current;
      const timing =
        s.kind === "respondiendo" || s.kind === "finalizandoSubtest" ? s.timing : null;
      if (timing && timing.timeLimitSeconds !== null) {
        const rem = remainingMs(s, now);
        if (rem !== null) {
          return Math.max(0, Math.round(timing.timeLimitSeconds - rem / 1000));
        }
      }
      flushActiveSubtestMs(now, false);
      const localMs = subtestAccumulatedMsRef.current.get(subtestId) ?? 0;
      if (localMs > 0) return Math.round(localMs / 1000);
      if (timing?.startedAt) {
        const startedMs = Date.parse(timing.startedAt);
        if (Number.isFinite(startedMs)) {
          return Math.max(0, Math.round((now - startedMs) / 1000));
        }
      }
      return 0;
    },
    [flushActiveSubtestMs],
  );

  const handleMutationError = useCallback(
    (err: unknown, capturedAssignmentId: number, capturedAttemptId?: number | null): boolean => {
      if (isStaleParticipantError(err)) return true;
      if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return true;
      if (isRuntimeBlocked(err)) {
        dispatch({ type: "SERVER_ERROR", code: err.code as RuntimeErrorCode, clientNow: Date.now() });
        return true;
      }
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        dispatch({ type: "ACCESS_REVOKED" });
        return true;
      }
      return false;
    },
    [isOwnerActive],
  );

  const startAttemptAction = useCallback(async (): Promise<boolean> => {
    const ev = currentEvaluation;
    if (!ev) return false;
    const capturedAssignmentId = ev.assignmentId;
    setActionError(null);
    setIsStartingAttempt(true);
    try {
      const deviceInfo =
        typeof navigator !== "undefined" && navigator.userAgent ? navigator.userAgent : "web";
      const attempt = await startAttempt({ assignmentId: capturedAssignmentId, deviceInfo });
      if (!isOwnerActive(capturedAssignmentId)) return false;

      attemptSeededRef.current = attempt.id;
      attemptAccumulatedMsRef.current = 0;
      attemptResumedAtRef.current = Date.now();

      queryClient.setQueryData<Evaluation>(
        runtimeKeys.evaluation(capturedAssignmentId),
        (prev) =>
          prev
            ? {
                ...prev,
                attemptId: attempt.id,
                attemptStatus: attempt.status,
              }
            : prev,
      );
      bindDraftOwner({ assignmentId: capturedAssignmentId, attemptId: attempt.id });
      dispatch({ type: "START_ATTEMPT_OK", attemptId: attempt.id });
      return true;
    } catch (err) {
      if (handleMutationError(err, capturedAssignmentId)) return false;
      setActionError(err instanceof ApiError ? err.message : "No se pudo iniciar la evaluación.");
      return false;
    } finally {
      if (mountedRef.current) setIsStartingAttempt(false);
    }
  }, [currentEvaluation, handleMutationError, isOwnerActive, queryClient]);

  const openSubtestAction = useCallback((subtestId: number) => {
    setActionError(null);
    dispatch({ type: "OPEN_SUBTEST", subtestId });
  }, []);

  const backToListAction = useCallback(() => {
    setActionError(null);
    dispatch({ type: "BACK_TO_LIST" });
  }, []);

  const startSubtestAction = useCallback(
    async (subtestId: number): Promise<number | null> => {
      const ev = currentEvaluation;
      if (!ev || ev.attemptId === null) return null;
      const capturedAssignmentId = ev.assignmentId;
      const capturedAttemptId = ev.attemptId;

      if (state.kind === "respondiendo" && state.subtestId === subtestId) {
        return state.ordinal;
      }

      setActionError(null);
      setIsStartingSubtest(true);
      try {
        const subtestAttempt = await startSubtest(capturedAttemptId, subtestId);
        if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return null;

        const existingSubtest = findSubtest(currentEvalRef.current ?? ev, subtestId);
        let loadedItems = existingSubtest?.items ?? [];
        if (loadedItems.length === 0) {
          const loaded = await queryClient.ensureQueryData(
            subtestItemsQueryOptions(capturedAssignmentId, capturedAttemptId, subtestId),
          );
          if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return null;
          loadedItems = loaded.items;
        }

        const now = Date.now();
        let nextEvaluationSnapshot: Evaluation | null = null;
        queryClient.setQueryData<Evaluation>(
          runtimeKeys.evaluation(capturedAssignmentId),
          (prev) => {
            if (!prev) return prev;
            nextEvaluationSnapshot = withUpdatedSubtest(prev, subtestId, (sub) => ({
              ...sub,
              status: "EN_PROGRESO",
              items: loadedItems.length > 0 ? loadedItems : sub.items,
              timeLimitSeconds:
                subtestAttempt.timeLimitSeconds !== undefined
                  ? subtestAttempt.timeLimitSeconds
                  : sub.timeLimitSeconds,
              timing: mergeTimingFromAttempt(sub.timing, subtestAttempt),
            }));
            return nextEvaluationSnapshot;
          },
        );

        if (nextEvaluationSnapshot && loadedItems.length > 0) {
          dispatch({
            type: "EVALUATION_LOADED",
            evaluation: nextEvaluationSnapshot,
            clientNow: now,
          });
        }
        if (stateRef.current.kind === "listaSubtests") {
          dispatch({ type: "OPEN_SUBTEST", subtestId });
        }
        dispatch(startSubtestOkEvent(subtestId, subtestAttempt, now, 1));
        subtestEnteredAtRef.current = { subtestId, at: now };
        return 1;
      } catch (err) {
        if (handleMutationError(err, capturedAssignmentId, capturedAttemptId)) return null;
        setActionError(err instanceof ApiError ? err.message : "No se pudo iniciar el subtest.");
        return null;
      } finally {
        if (mountedRef.current) setIsStartingSubtest(false);
      }
    },
    [currentEvaluation, handleMutationError, isOwnerActive, queryClient, state],
  );

  const goToItemAction = useCallback((ordinal: number) => {
    dispatch({ type: "GO_TO_ITEM", ordinal });
  }, []);

  const finishSubtestAction = useCallback(
    async (subtestId: number, reason: FinishReason = "usuario"): Promise<boolean> => {
      const ev = currentEvaluation;
      if (!ev || ev.attemptId === null) return false;
      if (finishingSubtestRef.current === subtestId) return false;

      const capturedAssignmentId = ev.assignmentId;
      const capturedAttemptId = ev.attemptId;
      finishingSubtestRef.current = subtestId;
      setActionError(null);
      setIsFinishingSubtest(true);

      const now = Date.now();
      flushActiveItemMs(now, false);
      const timeSeconds = computeSubtestSeconds(subtestId, now);

      if (reason === "tiempo") {
        if (stateRef.current.kind === "respondiendo") {
          dispatch({ type: "DEADLINE_REACHED" });
        }
      } else if (stateRef.current.kind === "respondiendo") {
        dispatch({ type: "REQUEST_FINISH_SUBTEST" });
      }

      try {
        try {
          await flushBeforeFinish(subtestId);
        } catch (flushErr) {
          if (isStaleParticipantError(flushErr)) return false;
          // No bloqueamos el cierre del subtest si el flush falla por red o rechazo.
        }

        if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return false;

        try {
          await finishSubtest(capturedAttemptId, subtestId, { timeSeconds });
        } catch (finishErr) {
          if (isStaleParticipantError(finishErr)) return false;
          if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return false;

          const closedByServer =
            finishErr instanceof ApiError &&
            finishErr.status === 409 &&
            (finishErr.code === "TIEMPO_AGOTADO" || finishErr.code === "SUBTEST_FINALIZADO");
          if (!closedByServer) {
            if (handleMutationError(finishErr, capturedAssignmentId, capturedAttemptId)) return false;
            if (reason === "usuario") {
              dispatch({ type: "FINISH_SUBTEST_FAILED", subtestId });
            }
            setActionError(
              finishErr instanceof ApiError ? finishErr.message : "No se pudo finalizar el subtest.",
            );
            return false;
          }
        }

        if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return false;

        queryClient.setQueryData<Evaluation>(
          runtimeKeys.evaluation(capturedAssignmentId),
          (prev) =>
            prev
              ? withUpdatedSubtest(prev, subtestId, (sub) => ({
                  ...sub,
                  status: "COMPLETADO",
                }))
              : prev,
        );

        dispatch({ type: "FINISH_SUBTEST_OK", subtestId });
        void navigate({ to: "/evaluacion/sesion", replace: true });
        return true;
      } finally {
        if (finishingSubtestRef.current === subtestId) {
          finishingSubtestRef.current = null;
        }
        if (mountedRef.current) setIsFinishingSubtest(false);
      }
    },
    [computeSubtestSeconds, currentEvaluation, flushActiveItemMs, handleMutationError, isOwnerActive, navigate, queryClient],
  );

  const effectiveNowMs =
    state.kind === "respondiendo" ? Math.max(nowMs, state.timing.receivedAt) : nowMs;
  const remainingTimeMs = remainingMs(state, effectiveNowMs);

  // Disparo único de DEADLINE_REACHED cuando remainingMs llega a 0
  useEffect(() => {
    if (state.kind !== "respondiendo" || state.timing.paused) return;
    const rem = remainingMs(state, effectiveNowMs);
    if (rem === null || rem > 0) return;

    const key = `${assignmentId ?? 0}:${state.evaluation.attemptId ?? 0}:${state.subtestId}:${state.timing.startedAt ?? state.timing.receivedAt}`;
    if (deadlineFiredKeyRef.current === key) return;
    deadlineFiredKeyRef.current = key;

    void finishSubtestAction(state.subtestId, "tiempo");
  }, [assignmentId, state, effectiveNowMs, finishSubtestAction]);

  const finishAttemptAction = useCallback(async (): Promise<boolean> => {
    const ev = currentEvaluation;
    if (!ev || ev.attemptId === null) return false;
    const capturedAssignmentId = ev.assignmentId;
    const capturedAttemptId = ev.attemptId;

    setActionError(null);
    setIsFinishingAttempt(true);
    const now = Date.now();
    flushAttemptMs(now, false);
    const timeSeconds = Math.max(0, Math.round(attemptAccumulatedMsRef.current / 1000));

    if (stateRef.current.kind === "resumen") {
      dispatch({ type: "REQUEST_FINISH_ATTEMPT" });
    }

    try {
      await flush({ force: true });
      if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return false;

      await finishAttempt(capturedAttemptId, { timeSeconds });
      if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return false;

      queryClient.setQueryData<Evaluation>(
        runtimeKeys.evaluation(capturedAssignmentId),
        (prev) => (prev ? { ...prev, attemptStatus: "COMPLETADO" } : prev),
      );
      clearRuntimeDraft();
      dispatch({ type: "FINISH_ATTEMPT_OK" });
      return true;
    } catch (err) {
      if (handleMutationError(err, capturedAssignmentId, capturedAttemptId)) return false;
      dispatch({ type: "FINISH_ATTEMPT_FAILED" });
      setActionError(err instanceof ApiError ? err.message : "No se pudo finalizar la evaluación.");
      return false;
    } finally {
      if (mountedRef.current) setIsFinishingAttempt(false);
    }
  }, [currentEvaluation, flushAttemptMs, handleMutationError, isOwnerActive, queryClient]);

  const ensureInstructionsRoute = useCallback(
    (subtestId: number) => {
      if (state.kind === "listaSubtests" && isSubtestOpenable(state.evaluation, subtestId)) {
        dispatch({ type: "OPEN_SUBTEST", subtestId });
      }
    },
    [state],
  );

  const ensureItemsRoute = useCallback(
    async (subtestId: number, ordinal: number): Promise<void> => {
      if (state.kind === "respondiendo") {
        if (
          state.subtestId === subtestId &&
          state.ordinal !== ordinal &&
          isValidOrdinal(ordinal, state.totalItems)
        ) {
          dispatch({ type: "GO_TO_ITEM", ordinal });
        }
        return;
      }

      if (state.kind !== "listaSubtests" && state.kind !== "instrucciones") {
        return;
      }

      const ev = state.evaluation;
      const subtest = findSubtest(ev, subtestId);
      if (!subtest || (subtest.status !== "EN_PROGRESO" && subtest.status !== "INTERRUMPIDO")) {
        return;
      }
      if (!isSubtestOpenable(ev, subtestId)) return;

      const capturedAssignmentId = ev.assignmentId;
      const capturedAttemptId = ev.attemptId;
      if (capturedAttemptId === null) return;

      let items = subtest.items;
      let targetEvaluation = ev;
      let currentKind: RunnerState["kind"] = state.kind;

      if (items.length === 0) {
        if (loadingItemsForRef.current === subtestId) return;
        loadingItemsForRef.current = subtestId;
        try {
          const loaded = await queryClient.ensureQueryData(
            subtestItemsQueryOptions(capturedAssignmentId, capturedAttemptId, subtestId),
          );
          if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return;
          items = loaded.items;
          if (items.length === 0) return;

          targetEvaluation = withUpdatedSubtest(ev, subtestId, (sub) => ({
            ...sub,
            items,
          }));
          queryClient.setQueryData<Evaluation>(
            runtimeKeys.evaluation(capturedAssignmentId),
            targetEvaluation,
          );
          dispatch({
            type: "EVALUATION_LOADED",
            evaluation: targetEvaluation,
            clientNow: Date.now(),
          });

          const latestState = stateRef.current;
          if (latestState.kind === "respondiendo") {
            const clamped = clampOrdinal(ordinal, latestState.totalItems);
            if (latestState.ordinal !== clamped) {
              dispatch({ type: "GO_TO_ITEM", ordinal: clamped });
            }
            return;
          }
          if (latestState.kind !== "listaSubtests" && latestState.kind !== "instrucciones") {
            return;
          }
          currentKind = latestState.kind;
        } catch (err) {
          handleMutationError(err, capturedAssignmentId, capturedAttemptId);
          return;
        } finally {
          if (loadingItemsForRef.current === subtestId) {
            loadingItemsForRef.current = null;
          }
        }
      }

      const safeOrdinal = clampOrdinal(ordinal, items.length);
      const now = Date.now();
      if (currentKind === "listaSubtests") {
        dispatch({ type: "OPEN_SUBTEST", subtestId });
      }
      dispatch({
        type: "START_SUBTEST_OK",
        subtestId,
        timing: subtest.timing ?? {},
        timeLimitSeconds: subtest.timeLimitSeconds,
        ordinal: safeOrdinal,
        clientNow: now,
      });
    },
    [state, handleMutationError, isOwnerActive, queryClient],
  );

  const getItemValue = useCallback(
    (item: RuntimeItem): AnswerValue | undefined => {
      const local = draftAnswers[item.id];
      if (local) return local.value;
      if (item.savedAnswer) return fromSavedAnswer(item.responseType, item.savedAnswer);
      return undefined;
    },
    [draftAnswers],
  );

  const setActiveItem = useCallback(
    (item: RuntimeItem | null, subtestId: number | null) => {
      const now = Date.now();
      const liveState = stateRef.current;
      const isRunning = liveState.kind === "respondiendo" && !liveState.timing.paused;
      const prev = activeItemRef.current;
      if (prev && item && prev.itemId === item.id && prev.subtestId === subtestId) {
        if (itemEnteredAtRef.current === null && isRunning) {
          itemEnteredAtRef.current = now;
        }
        return;
      }

      flushActiveItemMs(now, false);

      if (item !== null && subtestId !== null) {
        if (!itemAccumulatedMsRef.current.has(item.id)) {
          const localTime = useRuntimeDraft.getState().answers[item.id]?.timeUsedSeconds;
          const seedSeconds = localTime ?? item.savedAnswer?.timeUsedSeconds ?? 0;
          if (seedSeconds > 0) {
            itemAccumulatedMsRef.current.set(item.id, seedSeconds * 1000);
          }
        }
        activeItemRef.current = { itemId: item.id, subtestId };
        itemEnteredAtRef.current = isRunning ? now : null;
      } else {
        activeItemRef.current = null;
        itemEnteredAtRef.current = null;
      }
    },
    [flushActiveItemMs],
  );

  const saveItemValue = useCallback(
    async (item: RuntimeItem, subtestId: number, value: AnswerValue): Promise<void> => {
      const ev = currentEvalRef.current;
      if (!ev) return;
      const capturedAssignmentId = ev.assignmentId;
      const capturedAttemptId = ev.attemptId;
      const now = Date.now();
      const liveState = stateRef.current;

      if (!itemAccumulatedMsRef.current.has(item.id)) {
        const localTime = useRuntimeDraft.getState().answers[item.id]?.timeUsedSeconds;
        const seedSeconds = localTime ?? item.savedAnswer?.timeUsedSeconds ?? 0;
        if (seedSeconds > 0) {
          itemAccumulatedMsRef.current.set(item.id, seedSeconds * 1000);
        }
      }

      const accumulatedMs = itemAccumulatedMsRef.current.get(item.id) ?? 0;
      const liveMs =
        activeItemRef.current?.itemId === item.id &&
        itemEnteredAtRef.current !== null &&
        liveState.kind === "respondiendo" &&
        !liveState.timing.paused
          ? Math.max(0, now - itemEnteredAtRef.current)
          : 0;
      const timeUsedSeconds = Math.max(0, Math.round((accumulatedMs + liveMs) / 1000));

      try {
        await setAnswer(item.id, value, timeUsedSeconds, subtestId);
      } catch (err) {
        if (isStaleParticipantError(err)) return;
        if (!isOwnerActive(capturedAssignmentId, capturedAttemptId)) return;
        if (import.meta.env.DEV) {
          console.error("[runner] Error guardando respuesta", err);
        }
      }
    },
    [isOwnerActive],
  );

  const refetchEvaluation = useCallback(() => {
    void refetchEvaluationQuery();
  }, [refetchEvaluationQuery]);
  const clearActionError = useCallback(() => setActionError(null), []);

  const value = useMemo<RunnerContextValue>(
    () => ({
      state,
      evaluation: currentEvaluation,
      assignmentId,
      nowMs: effectiveNowMs,
      remainingTimeMs,
      evaluationError: state.kind === "validando" && evaluationQuery.isError ? evaluationQuery.error : null,
      refetchEvaluation,
      isStartingAttempt,
      isStartingSubtest,
      isFinishingSubtest,
      isFinishingAttempt,
      actionError,
      clearActionError,
      startAttemptAction,
      openSubtestAction,
      backToListAction,
      startSubtestAction,
      goToItemAction,
      finishSubtestAction,
      finishAttemptAction,
      ensureInstructionsRoute,
      ensureItemsRoute,
      getItemValue,
      saveItemValue,
      setActiveItem,
    }),
    [
      state,
      currentEvaluation,
      assignmentId,
      effectiveNowMs,
      remainingTimeMs,
      evaluationQuery.isError,
      evaluationQuery.error,
      refetchEvaluation,
      isStartingAttempt,
      isStartingSubtest,
      isFinishingSubtest,
      isFinishingAttempt,
      actionError,
      clearActionError,
      startAttemptAction,
      openSubtestAction,
      backToListAction,
      startSubtestAction,
      goToItemAction,
      finishSubtestAction,
      finishAttemptAction,
      ensureInstructionsRoute,
      ensureItemsRoute,
      getItemValue,
      saveItemValue,
      setActiveItem,
    ],
  );

  return <RunnerContext.Provider value={value}>{children}</RunnerContext.Provider>;
}

export function useRunner(): RunnerContextValue {
  const ctx = useContext(RunnerContext);
  if (!ctx) {
    throw new Error("useRunner debe usarse dentro de un <RunnerProvider>.");
  }
  return ctx;
}
