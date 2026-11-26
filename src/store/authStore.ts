/**
 * Shim de compatibilidad (F-03). La fuente de verdad ahora es `staffAuth`.
 * Mantiene la API legacy de `useAuthStore` para no romper imports existentes.
 * El código nuevo debe usar `useStaffAuth` directamente.
 */
import { useStaffAuth, type StaffUser } from "./staffAuth";

export interface CurrentUserDTO {
  id: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

export const normalizeRole = (role: string): string => {
  const clean = role.toUpperCase().replace(/^ROLE_/, "");
  if (clean.includes("ADMINISTRADOR") || clean === "ADMIN") return "admin";
  if (clean.includes("APLICADOR")) return "aplicador";
  if (clean.includes("PSICOLOGO") || clean.includes("COORDINADOR")) return "psicologo";
  if (clean.includes("CONSULTOR") || clean.includes("REPORTE")) return "consultor";
  return clean.toLowerCase();
};

interface AuthState {
  token: string | null;
  user: CurrentUserDTO | null;
  setToken: (token: string | null) => void;
  setUser: (user: CurrentUserDTO | null) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
}

type StaffState = ReturnType<typeof useStaffAuth.getState>;

// Los selectores de zustand v5 exigen snapshots estables: se memoiza por referencia.
const userCache = new WeakMap<StaffUser, CurrentUserDTO>();

const toLegacyUser = (user: StaffUser | null): CurrentUserDTO | null => {
  if (!user) return null;
  let legacy = userCache.get(user);
  if (!legacy) {
    legacy = {
      id: user.id,
      displayName: user.username,
      roles: user.roles.map(normalizeRole),
      permissions: user.permissions,
    };
    userCache.set(user, legacy);
  }
  return legacy;
};

const actions: Pick<AuthState, "setToken" | "setUser" | "logout" | "isAuthenticated" | "hasPermission" | "hasRole"> = {
  setToken: (token) => {
    if (token) {
      const { expiresAt, user } = useStaffAuth.getState();
      useStaffAuth.getState().setSession({ token, expiresAt, user });
    } else {
      useStaffAuth.getState().clear();
    }
  },
  setUser: (user) => {
    const { token } = useStaffAuth.getState();
    if (token === null) return; // sin sesión no hay a quién asignar el usuario
    useStaffAuth.getState().setUser(
      user ? { id: user.id, username: user.displayName, roles: user.roles, permissions: user.permissions } : null,
      token,
    );
  },
  logout: () => useStaffAuth.getState().clear(),
  isAuthenticated: () => useStaffAuth.getState().token !== null,
  hasPermission: (permission) => useStaffAuth.getState().hasPermission(permission),
  hasRole: (role) => {
    const user = useStaffAuth.getState().user;
    if (!user) return false;
    return user.roles.map(normalizeRole).includes(normalizeRole(role));
  },
};

let lastSource: StaffState | null = null;
let lastAdapted: AuthState | null = null;

const adapt = (source: StaffState): AuthState => {
  if (lastAdapted && lastSource === source) return lastAdapted;
  lastSource = source;
  lastAdapted = { token: source.token, user: toLegacyUser(source.user), ...actions };
  return lastAdapted;
};

interface UseAuthStore {
  (): AuthState;
  <T>(selector: (state: AuthState) => T): T;
  getState: () => AuthState;
}

export const useAuthStore: UseAuthStore = Object.assign(
  <T>(selector?: (state: AuthState) => T) =>
    useStaffAuth((source) => {
      const adapted = adapt(source);
      return selector ? selector(adapted) : adapted;
    }),
  { getState: () => adapt(useStaffAuth.getState()) },
) as UseAuthStore;
