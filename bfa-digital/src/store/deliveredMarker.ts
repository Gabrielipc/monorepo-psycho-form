/**
 * Marcador de «evaluación entregada» por asignación (sessionStorage, una clave por asignación, igual que el
 * draft y la sesión del participante). Solo se escribe cuando el servidor confirmó el finalizar del intento;
 * permite mostrar «entregada» (y no un bloqueo genérico) si al recargar el backend responde
 * 409 ASIGNACION_NO_OPERABLE. Todo acceso a storage va en try/catch: sin storage, simplemente no hay marcador.
 */
export const DELIVERED_MARKER_PREFIX = "bfa-runtime-delivered:";

const getStorage = (): Storage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

export const deliveredMarkerKey = (assignmentId: number): string => `${DELIVERED_MARKER_PREFIX}${assignmentId}`;

export function markDelivered(assignmentId: number): void {
  try {
    getStorage()?.setItem(deliveredMarkerKey(assignmentId), "1");
  } catch {
    // sin storage disponible: no hay marcador
  }
}

export function isDelivered(assignmentId: number | null): boolean {
  if (assignmentId === null) return false;
  try {
    return getStorage()?.getItem(deliveredMarkerKey(assignmentId)) === "1";
  } catch {
    return false;
  }
}

/** Elimina los marcadores de toda asignación distinta de `keepAssignmentId` (canje de un código de otra asignación). */
export function clearDeliveredMarkersExcept(keepAssignmentId: number | null): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    const keep = keepAssignmentId === null ? null : deliveredMarkerKey(keepAssignmentId);
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(DELIVERED_MARKER_PREFIX) && key !== keep) toRemove.push(key);
    }
    toRemove.forEach((key) => storage.removeItem(key));
  } catch {
    // ignorar
  }
}
