/**
 * Shim de compatibilidad: el código legacy importa `apiClient` desde aquí.
 * El código nuevo debe importar `staffClient` / `participantClient` de `./client`.
 */
import { staffClient } from "./client";

export const apiClient = staffClient;
