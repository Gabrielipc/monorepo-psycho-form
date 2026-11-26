import { isRuntimeKey, queryClient } from "../api/queryClient";

/**
 * Claves de localStorage con datos de servidor de una cuenta de staff. Se borran aunque
 * el store dueño todavía no se haya importado (si no, se hidratarían con datos ajenos).
 */
const ACCOUNT_SCOPED_STORAGE_KEYS = ["bfa-digital-admin-storage"] as const;

const resetters = new Set<() => void>();

/** Registra el reset de un store legacy con datos de servidor. Devuelve la función de baja. */
export function registerAccountReset(reset: () => void): () => void {
  resetters.add(reset);
  return () => {
    resetters.delete(reset);
  };
}

/**
 * Descarta TODO el estado ligado a la cuenta de staff saliente: caché de React Query
 * (incluida `['auth','me',…]`), stores zustand legacy y su persistencia. Las queries y
 * mutations cuya key empieza por `runtime` (participante) se conservan.
 * Se invoca en logout, 401, expiración, cambio de cuenta y cambio de sesión desde otra pestaña.
 */
export function resetAccountScopedState(): void {
  const isStaffQuery = (query: { queryKey: readonly unknown[] }): boolean => !isRuntimeKey(query.queryKey);
  void queryClient.cancelQueries({ predicate: isStaffQuery });
  queryClient.removeQueries({ predicate: isStaffQuery });
  const mutations = queryClient.getMutationCache();
  for (const mutation of mutations.getAll()) {
    if (!isRuntimeKey(mutation.options.mutationKey)) mutations.remove(mutation);
  }

  for (const reset of resetters) {
    try {
      reset();
    } catch (error) {
      console.error("No se pudo reiniciar un store al cambiar de cuenta", error);
    }
  }

  try {
    for (const key of ACCOUNT_SCOPED_STORAGE_KEYS) localStorage.removeItem(key);
  } catch {
    // storage no disponible: nada que limpiar
  }
}
