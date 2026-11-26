import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ParticipantEvaluationAccessDTO } from '../api/participantMappers';
import { SaveAnswerRequest } from '../api/types';

/** Respuesta encolada offline, marcada con su dueño para no cruzarla con otro participante. */
export interface QueuedAnswer extends SaveAnswerRequest {
  assignmentId: number;
  /** null solo si se encoló antes de existir el intento; se adopta al crearlo (mismo assignmentId). */
  attemptId: number | null;
}

/**
 * Respuesta que el backend rechazó de forma DEFINITIVA en bulk-sync (subtest finalizado,
 * tiempo agotado…). Se retira de la cola pero se conserva aquí con su motivo para no perderla
 * en silencio.
 */
export interface RejectedAnswer {
  itemId: number;
  assignmentId: number;
  attemptId: number | null;
  /** Código del backend (`SUBTEST_FINALIZADO`, `TIEMPO_AGOTADO`, …). */
  code: string;
  /** Texto legible del motivo. */
  reason: string;
  /** Fecha ISO en que se registró el rechazo. */
  rejectedAt: string;
}

/** Misma versión de la respuesta: igual dueño, ítem y contenido (el `attemptId` puede haberse adoptado después). */
const isSameAnswerVersion = (a: QueuedAnswer, b: QueuedAnswer): boolean =>
  a.itemId === b.itemId &&
  a.assignmentId === b.assignmentId &&
  a.textAnswer === b.textAnswer &&
  a.numericAnswer === b.numericAnswer &&
  a.timeUsedSeconds === b.timeUsedSeconds &&
  a.selectedOptionIds.length === b.selectedOptionIds.length &&
  a.selectedOptionIds.every((id, index) => id === b.selectedOptionIds[index]);

interface EvaluationState {
  accessData: ParticipantEvaluationAccessDTO | null;
  attemptId: number | null;
  /** Asignación/intento a los que pertenecen answers y syncQueue. */
  ownerAssignmentId: number | null;
  ownerAttemptId: number | null;
  timeLeft: number;
  activeSubtestId: string | null;
  answers: Record<string, string>; // subtestId-itemId -> optionId
  
  // Cola local temporal de resiliencia
  syncQueue: QueuedAnswer[];
  /** Respuestas descartadas de la cola por rechazo definitivo del backend (con su motivo). */
  rejectedAnswers: RejectedAnswer[];
  isOffline: boolean;
  
  setAccessData: (accessData: ParticipantEvaluationAccessDTO | null) => void;
  setAttemptId: (attemptId: number | null) => void;
  setOwner: (assignmentId: number | null) => void;
  setTimeLeft: (time: number | ((prev: number) => number)) => void;
  setActiveSubtestId: (id: string | null) => void;
  setAnswer: (subtestId: string, itemId: string, optionId: string) => void;
  
  // Manejo de la cola y red
  setOffline: (isOffline: boolean) => void;
  addToQueue: (answer: QueuedAnswer) => void;
  /** Quita de la cola solo las entradas indicadas (por referencia): la cola pudo cambiar mientras se enviaban. */
  removeFromQueue: (sent: readonly QueuedAnswer[]) => void;
  /** Reemplaza la cola (p. ej. tras descartar entradas ajenas). */
  setQueue: (queue: QueuedAnswer[]) => void;
  /** Registra rechazos definitivos (uno por ítem y asignación: el más reciente reemplaza al anterior). */
  addRejectedAnswers: (rejected: readonly RejectedAnswer[]) => void;
  clearQueue: () => void;
  clearStore: () => void;
}

export const EVALUATION_STORAGE_KEY = 'bfa-digital-evaluation-storage';

// Antes vivía en localStorage (compartido entre participantes): se elimina el residuo.
try {
  localStorage.removeItem(EVALUATION_STORAGE_KEY);
} catch {
  // storage no disponible
}

export const useEvaluationStore = create<EvaluationState>()(
  persist(
    (set) => ({
      accessData: null,
      attemptId: null,
      ownerAssignmentId: null,
      ownerAttemptId: null,
      timeLeft: 0,
      activeSubtestId: null,
      answers: {},
      syncQueue: [],
      rejectedAnswers: [],
      isOffline: false,

      setAccessData: (accessData) => set({ accessData }),
      
      // El intento pertenece siempre a la asignación dueña actual.
      setAttemptId: (attemptId) => set({ attemptId, ownerAttemptId: attemptId }),

      setOwner: (assignmentId) => set({ ownerAssignmentId: assignmentId }),

      setTimeLeft: (time) => set((state) => ({
        timeLeft: typeof time === 'function' ? time(state.timeLeft) : time
      })),

      setActiveSubtestId: (id) => set({ activeSubtestId: id }),

      setAnswer: (subtestId, itemId, optionId) => set((state) => ({
        answers: {
          ...state.answers,
          [`${subtestId}-${itemId}`]: optionId
        }
      })),

      setOffline: (isOffline) => set({ isOffline }),

      addToQueue: (answer) => set((state) => {
        // Evitar duplicados del mismo itemId en la cola, reemplazando el viejo
        const filtered = state.syncQueue.filter(item => item.itemId !== answer.itemId);
        return {
          syncQueue: [...filtered, answer]
        };
      }),

      removeFromQueue: (sent) => set((state) => ({
        // Se retira solo la MISMA versión que se envió (misma referencia, o copia con el mismo
        // contenido, p. ej. al adoptar el attemptId): una versión más nueva del ítem encolada
        // mientras volaba el envío se conserva.
        syncQueue: state.syncQueue.filter((item) => !sent.some((s) => s === item || isSameAnswerVersion(s, item)))
      })),

      setQueue: (queue) => set({ syncQueue: queue }),

      addRejectedAnswers: (rejected) => set((state) => ({
        rejectedAnswers: [
          ...state.rejectedAnswers.filter(
            (old) => !rejected.some((r) => r.itemId === old.itemId && r.assignmentId === old.assignmentId),
          ),
          ...rejected,
        ],
      })),

      clearQueue: () => set({ syncQueue: [] }),

      clearStore: () => set({
        accessData: null,
        attemptId: null,
        ownerAssignmentId: null,
        ownerAttemptId: null,
        timeLeft: 0,
        activeSubtestId: null,
        answers: {},
        syncQueue: [],
        rejectedAnswers: [],
        isOffline: false
      })
    }),
    {
      name: EVALUATION_STORAGE_KEY,
      // sessionStorage (por pestaña, como participantAuth): sobrevive a recargas, no cruza participantes.
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        accessData: state.accessData,
        attemptId: state.attemptId,
        ownerAssignmentId: state.ownerAssignmentId,
        ownerAttemptId: state.ownerAttemptId,
        timeLeft: state.timeLeft,
        activeSubtestId: state.activeSubtestId,
        answers: state.answers,
        syncQueue: state.syncQueue,
        rejectedAnswers: state.rejectedAnswers
      })
    }
  )
);
