import { z } from "zod";

export const GeneralStatusSchema = z.enum(["ACTIVO", "INACTIVO", "DESCONOCIDO"]).catch("DESCONOCIDO");
export type GeneralStatus = z.output<typeof GeneralStatusSchema>;

export const BackupStatusSchema = z.enum(["GENERADO", "DESCONOCIDO"]).catch("DESCONOCIDO");
export type BackupStatus = z.output<typeof BackupStatusSchema>;

// GET /users, POST /users, PATCH /users/{id}/status -> UserDto
export const AdminUserSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    email: z.string(),
    fullName: z.string(),
    status: GeneralStatusSchema,
  })
  .loose();
export type AdminUser = z.output<typeof AdminUserSchema>;
export const AdminUserListSchema = z.array(AdminUserSchema);

// GET /users/permission-matrix -> UserManagementService.PermissionMatrix
const UserPermissionRowSchema = z
  .object({
    userId: z.string(),
    username: z.string(),
    email: z.string(),
    fullName: z.string(),
    status: GeneralStatusSchema,
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
    matrix: z.record(z.string(), z.boolean()),
  })
  .loose();
export type UserPermissionRow = z.output<typeof UserPermissionRowSchema>;

export const PermissionMatrixSchema = z
  .object({
    permissionColumns: z.array(z.string()),
    users: z.array(UserPermissionRowSchema),
  })
  .loose();
export type PermissionMatrix = z.output<typeof PermissionMatrixSchema>;

// GET /roles -> Rol
export const RoleSchema = z
  .object({
    id: z.number(),
    nombre: z.string(),
    descripcion: z.string().nullable().optional(),
  })
  .loose()
  .transform((w) => ({
    id: w.id,
    name: w.nombre,
    description: w.descripcion ?? null,
  }));
export type Role = z.output<typeof RoleSchema>;
export const RoleListSchema = z.array(RoleSchema);

// GET /permissions, GET /roles/{id}/permissions -> Permiso
export const PermissionSchema = z
  .object({
    id: z.number(),
    codigo: z.string(),
    descripcion: z.string().nullable().optional(),
  })
  .loose()
  .transform((w) => ({
    id: w.id,
    code: w.codigo,
    description: w.descripcion ?? null,
  }));
export type Permission = z.output<typeof PermissionSchema>;
export const PermissionListSchema = z.array(PermissionSchema);

// GET /auditoria -> Auditoria
const AuditActorWireSchema = z
  .object({
    id: z.string().optional(),
    nombreUsuario: z.string().optional(),
    nombreCompleto: z.string().optional(),
  })
  .loose();

export const AuditLogSchema = z
  .object({
    id: z.number(),
    usuario: AuditActorWireSchema.nullable().optional(),
    accion: z.string(),
    entidad: z.string(),
    entidadId: z.string().nullable().optional(),
    valorAnterior: z.string().nullable().optional(),
    valorNuevo: z.string().nullable().optional(),
    direccionIp: z.string().nullable().optional(),
    agenteUsuario: z.string().nullable().optional(),
    creadoEn: z.string(),
  })
  .loose()
  .transform((w) => ({
    id: w.id,
    userId: w.usuario?.id ?? null,
    username: w.usuario?.nombreUsuario ?? null,
    action: w.accion,
    entity: w.entidad,
    entityId: w.entidadId ?? null,
    previousValue: w.valorAnterior ?? null,
    newValue: w.valorNuevo ?? null,
    ipAddress: w.direccionIp ?? null,
    userAgent: w.agenteUsuario ?? null,
    createdAt: w.creadoEn,
  }));
export type AuditLog = z.output<typeof AuditLogSchema>;
export const AuditLogListSchema = z.array(AuditLogSchema);

// GET /backups, POST /backups -> BackupService.BackupView
export const BackupSchema = z
  .object({
    fileName: z.string(),
    path: z.string(),
    sizeBytes: z.number(),
    generatedAt: z.string(),
    status: BackupStatusSchema,
  })
  .loose();
export type Backup = z.output<typeof BackupSchema>;
export const BackupListSchema = z.array(BackupSchema);

// POST /backups/{fileName}/restore-requests -> BackupService.RestoreRequestView
export const RestoreRequestSchema = z
  .object({
    fileName: z.string(),
    auditId: z.number(),
    requestedAt: z.string(),
  })
  .loose();
export type RestoreRequest = z.output<typeof RestoreRequestSchema>;

// GET /search -> SearchResult[]
export const SearchResultSchema = z
  .object({
    type: z.string(),
    id: z.string(),
    label: z.string(),
    path: z.string(),
  })
  .loose();
export type SearchResult = z.output<typeof SearchResultSchema>;
export const SearchResultListSchema = z.array(SearchResultSchema);

// GET /notifications -> NotificationController.NotificationView[]
export const NotificationSchema = z
  .object({
    id: z.number(),
    action: z.string(),
    entity: z.string(),
    entityId: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .loose()
  .transform((w) => ({
    id: w.id,
    action: w.action,
    entity: w.entity,
    entityId: w.entityId ?? null,
    createdAt: w.createdAt,
  }));
export type Notification = z.output<typeof NotificationSchema>;
export const NotificationListSchema = z.array(NotificationSchema);
