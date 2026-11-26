import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient } from '../api/axios';
import { catalogService } from '../api/catalogService';
import { Carrera, CatalogoSexo, Cohorte, GrupoAcademico, ParticipantRequest } from '../api/types';
import { mapParticipant } from './participantMapper';
import { registerAccountReset } from './accountReset';
import { captureAccountScope } from './accountScope';

export interface Participant {
  id: string; // UUID string
  code: string;
  name: string;
  age: number;
  sex: string;
  fechaNacimiento?: string;
  carreraId?: number;
  carrera: string;
  cohorteId?: number;
  cohorte: string;
  grupoId?: number;
  grupo: string;
  registeredAt: string;
  latestAttemptStatus: string;
}

export interface Session {
  id: string; // numeric ID as string
  code: string;
  name: string;
  group: string;
  date: string;
  time: string;
  location: string;
  applicator: string;
  status: 'PLANIFICADA' | 'ACTIVA' | 'PAUSADA' | 'FINALIZADA';
  subtests: string[]; // subtest codes
}

export interface SessionAssignment {
  participantId: string;
  participantName: string;
  token: string;
  status: 'GENERADO' | 'ACTIVO' | 'VENCIDO' | 'REVOCADO';
  currentSubtestId: string; // id o '—'
  overallProgress: number; // 0 a 100
  state: 'no-iniciado' | 'en-progreso' | 'completado' | 'interrumpido' | 'anulado';
  lastActivity: string;
  assignmentId: number;
  attemptId?: number | null;
}

interface AdminState {
  participants: Participant[];
  sessions: Session[];
  assignments: Record<string, SessionAssignment[]>; // sessionId -> assignments
  generatedTokens: Record<string, string>; // assignmentId -> rawToken
  versionSubtests: Record<string, any[]>;
  loading: boolean;
  error: string | null;

  carreras: Carrera[];
  gruposAcademicos: GrupoAcademico[];
  cohortes: Cohorte[];
  sexos: CatalogoSexo[];

  fetchCarreras: () => Promise<void>;
  createCarrera: (carrera: Omit<Carrera, "id">) => Promise<void>;
  removeCarrera: (id: number) => Promise<void>;
  fetchGrupos: () => Promise<void>;
  createGrupo: (grupo: Omit<GrupoAcademico, "id">) => Promise<void>;
  removeGrupo: (id: number) => Promise<void>;
  fetchCohortes: () => Promise<void>;
  createCohorte: (cohorte: Omit<Cohorte, "id">) => Promise<void>;
  removeCohorte: (id: number) => Promise<void>;
  fetchSexos: () => Promise<void>;
  createSexo: (sexo: Omit<CatalogoSexo, "id">) => Promise<void>;
  removeSexo: (id: number) => Promise<void>;

  fetchParticipants: () => Promise<void>;
  /** Devuelve la lista cargada, o `null` si la carga falló o la cuenta cambió (resultado propio de ESTA llamada). */
  fetchSessions: () => Promise<Session[] | null>;
  /** `true` si la carga terminó bien; `false` si falló o la cuenta cambió. */
  fetchAssignments: (sessionId: string) => Promise<boolean>;
  fetchVersionSubtests: (versionId: string) => Promise<void>;
  addParticipant: (participant: ParticipantRequest) => Promise<void>;
  createSession: (
    sessionData: {
      versionTestId: number;
      code: string;
      name: string;
      description?: string;
      scheduledStart: string;
      scheduledEnd: string;
      location?: string;
    },
    subtestConfigs: {
      subtestId: number;
      order: number;
      timeLimitSeconds?: number;
      randomizeItems: boolean;
      randomizeOptions: boolean;
    }[],
    participantIds: string[]
  ) => Promise<void>;
  updateSessionStatus: (sessionId: string, status: Session['status']) => Promise<void>;
}

export const ADMIN_STORAGE_KEY = 'bfa-digital-admin-storage';

/** 0 = persistía `generatedTokens`; 1 = no persiste ningún dato de servidor ni credencial. */
const ADMIN_STORAGE_VERSION = 1;

/** Estado de datos (sin acciones) con el que arranca el store. Cada llamada devuelve referencias nuevas. */
const createInitialAdminData = () => ({
  participants: [] as Participant[],
  sessions: [] as Session[],
  assignments: {} as AdminState['assignments'],
  generatedTokens: {} as AdminState['generatedTokens'],
  versionSubtests: {} as AdminState['versionSubtests'],
  loading: false,
  error: null as string | null,
  carreras: [] as Carrera[],
  gruposAcademicos: [] as GrupoAcademico[],
  cohortes: [] as Cohorte[],
  sexos: [] as CatalogoSexo[],
});

export const useAdminStore = create<AdminState>()(
  persist(
    (set, get) => ({
      ...createInitialAdminData(),

      fetchCarreras: async () => {
        set({ loading: true, error: null });
        try {
          const list = await catalogService.getCarreras();
          set({ carreras: list, loading: false });
        } catch (err: any) {
          set({ error: err.message, loading: false });
        }
      },
      createCarrera: async (c) => {
        set({ loading: true, error: null });
        try {
          await catalogService.createCarrera(c);
          await get().fetchCarreras();
        } catch (err: any) {
          set({ error: err.message, loading: false });
          throw err;
        }
      },
      removeCarrera: async (id) => {
        set({ loading: true, error: null });
        try {
          await catalogService.deleteCarrera(id);
          await get().fetchCarreras();
        } catch (err: any) {
          set({ error: err.message, loading: false });
          throw err;
        }
      },

      fetchGrupos: async () => {
        set({ loading: true, error: null });
        try {
          const list = await catalogService.getGrupos();
          set({ gruposAcademicos: list, loading: false });
        } catch (err: any) {
          set({ error: err.message, loading: false });
        }
      },
      createGrupo: async (g) => {
        set({ loading: true, error: null });
        try {
          await catalogService.createGrupo(g);
          await get().fetchGrupos();
        } catch (err: any) {
          set({ error: err.message, loading: false });
          throw err;
        }
      },
      removeGrupo: async (id) => {
        set({ loading: true, error: null });
        try {
          await catalogService.deleteGrupo(id);
          await get().fetchGrupos();
        } catch (err: any) {
          set({ error: err.message, loading: false });
          throw err;
        }
      },

      fetchCohortes: async () => {
        set({ loading: true, error: null });
        try {
          const list = await catalogService.getCohortes();
          set({ cohortes: list, loading: false });
        } catch (err: any) {
          set({ error: err.message, loading: false });
        }
      },
      createCohorte: async (c) => {
        set({ loading: true, error: null });
        try {
          await catalogService.createCohorte(c);
          await get().fetchCohortes();
        } catch (err: any) {
          set({ error: err.message, loading: false });
          throw err;
        }
      },
      removeCohorte: async (id) => {
        set({ loading: true, error: null });
        try {
          await catalogService.deleteCohorte(id);
          await get().fetchCohortes();
        } catch (err: any) {
          set({ error: err.message, loading: false });
          throw err;
        }
      },

      fetchSexos: async () => {
        set({ loading: true, error: null });
        try {
          const list = await catalogService.getSexos();
          set({ sexos: list, loading: false });
        } catch (err: any) {
          set({ error: err.message, loading: false });
        }
      },
      createSexo: async (s) => {
        set({ loading: true, error: null });
        try {
          await catalogService.createSexo(s);
          await get().fetchSexos();
        } catch (err: any) {
          set({ error: err.message, loading: false });
          throw err;
        }
      },
      removeSexo: async (id) => {
        set({ loading: true, error: null });
        try {
          await catalogService.deleteSexo(id);
          await get().fetchSexos();
        } catch (err: any) {
          set({ error: err.message, loading: false });
          throw err;
        }
      },

      fetchParticipants: async () => {
        set({ loading: true, error: null });
        try {
          const state = get();
          const [
            carreras,
            cohortes,
            gruposAcademicos,
            sexos
          ] = await Promise.all([
            state.carreras.length > 0 ? Promise.resolve(state.carreras) : catalogService.getCarreras(),
            state.cohortes.length > 0 ? Promise.resolve(state.cohortes) : catalogService.getCohortes(),
            state.gruposAcademicos.length > 0 ? Promise.resolve(state.gruposAcademicos) : catalogService.getGrupos(),
            state.sexos.length > 0 ? Promise.resolve(state.sexos) : catalogService.getSexos(),
          ]);

          const res = await apiClient.get('/participantes');
          if (res.data.success) {
            const mapped = res.data.data.map((p: any) => mapParticipant(p, {
              carreras,
              cohortes,
              gruposAcademicos,
              sexos,
            }));
            set({
              participants: mapped,
              carreras,
              cohortes,
              gruposAcademicos,
              sexos,
              loading: false
            });
          } else {
            throw new Error(res.data.message);
          }
        } catch (err: any) {
          set({ error: err.message, loading: false });
        }
      },

      fetchSessions: async () => {
        const scope = captureAccountScope();
        set({ loading: true, error: null });
        try {
          const res = await apiClient.get('/sesiones');
          if (!scope.isCurrent()) return null;
          if (res.data.success) {
            const mapped = res.data.data.map((s: any) => {
              let status: Session['status'] = 'PLANIFICADA';
              if (s.estado === 'ABIERTA') status = 'ACTIVA';
              if (s.estado === 'CERRADA') status = 'FINALIZADA';
              if (s.estado === 'CANCELADA') status = 'PAUSADA';

              return {
                id: String(s.id),
                code: s.codigoSesion,
                name: s.nombreSesion || s.codigoSesion,
                group: 'BFA - General',
                date: s.inicioProgramado ? s.inicioProgramado.split('T')[0] : '',
                time: s.inicioProgramado ? s.inicioProgramado.split('T')[1]?.slice(0, 5) : '',
                location: s.ubicacion || 'Virtual',
                applicator: 'Aplicador',
                status,
                subtests: ['figuras', 'desplazamiento', 'espacial']
              };
            });
            set({ sessions: mapped, loading: false });
            return mapped as Session[];
          } else {
            throw new Error(res.data.message);
          }
        } catch (err: any) {
          if (!scope.isCurrent()) return null;
          set({ error: err.message, loading: false });
          return null;
        }
      },

      fetchAssignments: async (sessionId: string) => {
        const scope = captureAccountScope();
        set({ loading: true, error: null });
        try {
          const res = await apiClient.get(`/sesiones/${sessionId}/asignaciones`);
          if (!scope.isCurrent()) return false;
          if (res.data.success) {
            const localTokens = get().generatedTokens || {};
            const mapped: SessionAssignment[] = res.data.data.map((a: any) => {
              const assignmentId = String(a.assignmentId);
              let rawToken = localTokens[assignmentId];
              if (!rawToken || rawToken.includes("undefined")) {
                rawToken = `${assignmentId}-***`;
              }

              return {
                participantId: a.participantId,
                participantName: a.participantName,
                token: rawToken,
                status: a.status as SessionAssignment['status'],
                currentSubtestId: a.currentSubtestId || '—',
                overallProgress: a.overallProgress || 0,
                state: a.state as SessionAssignment['state'],
                lastActivity: a.lastActivity ? (a.lastActivity.includes('T') ? a.lastActivity.split('T')[1].slice(0, 5) : a.lastActivity) : 'Nunca',
                assignmentId: a.assignmentId,
                attemptId: a.attemptId ?? null
              };
            });
            set((state) => ({
              assignments: {
                ...state.assignments,
                [sessionId]: mapped
              },
              loading: false
            }));
            return true;
          } else {
            throw new Error(res.data.message);
          }
        } catch (err: any) {
          if (!scope.isCurrent()) return false;
          set({ error: err.message, loading: false });
          return false;
        }
      },

      fetchVersionSubtests: async (versionId: string) => {
        try {
          const res = await apiClient.get(`/test-versions/${versionId}/subtests`);
          if (res.data.success) {
            set((state) => ({
              versionSubtests: {
                ...state.versionSubtests,
                [versionId]: res.data.data
              }
            }));
          }
        } catch (err) {
          console.error('Error fetching subtests:', err);
        }
      },

      addParticipant: async (p) => {
        set({ loading: true, error: null });
        try {
          const res = await apiClient.post('/participantes', p);
          if (res.data.success) {
            await get().fetchParticipants();
          } else {
            throw new Error(res.data.message);
          }
        } catch (err: any) {
          set({ error: err.message, loading: false });
          throw err;
        }
      },

      createSession: async (sessionData, subtestConfigs, participantIds) => {
        set({ loading: true, error: null });
        try {
          const res = await apiClient.post('/sesiones', sessionData);
          if (!res.data.success) throw new Error(res.data.message);
          const newSession = res.data.data;
          const sessionId = newSession.id;

          await apiClient.put(`/sesiones/${sessionId}/subtests`, subtestConfigs);

          const newTokens: Record<string, string> = { ...get().generatedTokens };
          for (const pId of participantIds) {
            const assignRes = await apiClient.post(`/sesiones/${sessionId}/asignaciones`, {
              participantId: pId
            });
            if (!assignRes.data.success) {
              throw new Error(assignRes.data.message || `No se pudo asignar el participante ${pId}.`);
            }
            const assigned = assignRes.data.data;
            const assignmentId = String(assigned.assignmentId);
            newTokens[assignmentId] = `${assignmentId}-${assigned.rawToken}`;
          }

          set({ generatedTokens: newTokens });
          await get().fetchSessions();
          await get().fetchAssignments(String(sessionId));
        } catch (err: any) {
          set({ error: err.message, loading: false });
          throw err;
        }
      },

      updateSessionStatus: async (sessionId, status) => {
        set({ loading: true, error: null });
        try {
          let url = `/sesiones/${sessionId}/activar`;
          if (status === 'PAUSADA') url = `/sesiones/${sessionId}/cancelar`;
          if (status === 'FINALIZADA') url = `/sesiones/${sessionId}/cerrar`;
          
          const res = await apiClient.post(url);
          if (res.data.success) {
            await get().fetchSessions();
            await get().fetchAssignments(sessionId);
          } else {
            throw new Error(res.data.message);
          }
        } catch (err: any) {
          set({ error: err.message, loading: false });
          throw err;
        }
      },

    }),
    {
      name: ADMIN_STORAGE_KEY,
      version: ADMIN_STORAGE_VERSION,
      // `generatedTokens` (tokens de acceso de participantes) vive SOLO en memoria: nunca se
      // persiste. La versión 0 sí los guardaba; la migración los elimina del storage al hidratar.
      partialize: () => ({}),
      migrate: (persisted) => {
        const { generatedTokens: _discarded, ...rest } = (persisted ?? {}) as Record<string, unknown>;
        void _discarded;
        return rest as unknown as AdminState;
      },
    }
  )
);

/**
 * Devuelve el store al estado inicial y borra su persistencia. Se ejecuta en cada cambio
 * de cuenta de staff (login con otro usuario, logout, 401, expiración) para que los datos
 * de servidor de una cuenta nunca se vean desde otra.
 */
export function resetAdminStore(): void {
  useAdminStore.setState(createInitialAdminData());
  useAdminStore.persist.clearStorage();
}

registerAccountReset(resetAdminStore);
