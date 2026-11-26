import { staffClient } from "../client";
import { unwrap, type ApiEnvelope } from "../errors";
import { parseOrThrow } from "../schemas/parse";
import {
  AdminUserListSchema,
  AdminUserSchema,
  AuditLogListSchema,
  BackupListSchema,
  BackupSchema,
  NotificationListSchema,
  PermissionListSchema,
  PermissionMatrixSchema,
  RestoreRequestSchema,
  RoleListSchema,
  SearchResultListSchema,
  type AdminUser,
  type AuditLog,
  type Backup,
  type Notification,
  type Permission,
  type PermissionMatrix,
  type RestoreRequest,
  type Role,
  type SearchResult,
} from "../schemas/admin";

export interface CreateUserInput {
  username: string;
  email: string;
  fullName: string;
  password: string;
}

export type UserStatusInput = "ACTIVO" | "INACTIVO";

export interface ListAuditParams {
  entity?: string;
  entityId?: string;
}

export interface DownloadedBackup {
  fileName: string;
  blob: Blob;
}

const filenameFromDisposition = (disposition: unknown, fallback: string): string => {
  if (typeof disposition !== "string") return fallback;
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? fallback;
};

export async function listUsers(): Promise<AdminUser[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/users");
  return parseOrThrow(AdminUserListSchema, unwrap(res), "GET /users");
}

export async function getPermissionMatrix(): Promise<PermissionMatrix> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/users/permission-matrix");
  return parseOrThrow(PermissionMatrixSchema, unwrap(res), "GET /users/permission-matrix");
}

export async function createUser(input: CreateUserInput): Promise<AdminUser> {
  const res = await staffClient.post<ApiEnvelope<unknown>>("/users", input);
  return parseOrThrow(AdminUserSchema, unwrap(res), "POST /users");
}

export async function setUserStatus(id: string, status: UserStatusInput): Promise<AdminUser> {
  const res = await staffClient.patch<ApiEnvelope<unknown>>(`/users/${id}/status`, { status });
  return parseOrThrow(AdminUserSchema, unwrap(res), `PATCH /users/${id}/status`);
}

export async function assignRole(userId: string, roleId: number): Promise<void> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(`/users/${userId}/roles`, { roleId });
  unwrap(res);
}

export async function removeRole(userId: string, roleId: number): Promise<void> {
  const res = await staffClient.delete<ApiEnvelope<unknown>>(`/users/${userId}/roles/${roleId}`);
  unwrap(res);
}

export async function listRoles(): Promise<Role[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/roles");
  return parseOrThrow(RoleListSchema, unwrap(res), "GET /roles");
}

export async function listPermissions(): Promise<Permission[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/permissions");
  return parseOrThrow(PermissionListSchema, unwrap(res), "GET /permissions");
}

export async function getRolePermissions(roleId: number): Promise<Permission[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>(`/roles/${roleId}/permissions`);
  return parseOrThrow(PermissionListSchema, unwrap(res), `GET /roles/${roleId}/permissions`);
}

export async function setRolePermissions(roleId: number, permissionIds: number[]): Promise<void> {
  const res = await staffClient.put<ApiEnvelope<unknown>>(`/roles/${roleId}/permissions`, { permissionIds });
  unwrap(res);
}

export async function listAudit(params: ListAuditParams = {}): Promise<AuditLog[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/auditoria", { params });
  return parseOrThrow(AuditLogListSchema, unwrap(res), "GET /auditoria");
}

export async function listBackups(): Promise<Backup[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/backups");
  return parseOrThrow(BackupListSchema, unwrap(res), "GET /backups");
}

export async function createBackup(): Promise<Backup> {
  const res = await staffClient.post<ApiEnvelope<unknown>>("/backups");
  return parseOrThrow(BackupSchema, unwrap(res), "POST /backups");
}

export async function downloadBackup(fileName: string): Promise<DownloadedBackup> {
  const res = await staffClient.get<Blob>(`/backups/${encodeURIComponent(fileName)}`, {
    responseType: "blob",
  });
  return {
    fileName: filenameFromDisposition(res.headers["content-disposition"], fileName),
    blob: res.data,
  };
}

export async function requestRestore(fileName: string): Promise<RestoreRequest> {
  const res = await staffClient.post<ApiEnvelope<unknown>>(
    `/backups/${encodeURIComponent(fileName)}/restore-requests`,
  );
  return parseOrThrow(RestoreRequestSchema, unwrap(res), `POST /backups/${fileName}/restore-requests`);
}

export async function search(q: string): Promise<SearchResult[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/search", { params: { q } });
  return parseOrThrow(SearchResultListSchema, unwrap(res), "GET /search");
}

export async function listNotifications(): Promise<Notification[]> {
  const res = await staffClient.get<ApiEnvelope<unknown>>("/notifications");
  return parseOrThrow(NotificationListSchema, unwrap(res), "GET /notifications");
}
