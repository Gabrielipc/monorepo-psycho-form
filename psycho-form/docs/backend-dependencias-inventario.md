# Inventario backend B1–B23 (Paso 0)

Rama: `feat/backend-dependencias-frontend` (desde `refactor/frontend-produccion`, `fed3397`).
Base: `./mvnw test` → 239 tests, 0 fallos.
Rutas relativas a `psycho-form/psychoform/src/main/java/com/uam/psychoform/`, salvo que se indique otra cosa.

| ID | Estado inicial | Evidencia | Spec |
|---|---|---|---|
| B1 | **HECHO** | `SessionController.java:56-73` (`/pausar`, `/reanudar`, `/pausas`); `SesionAplicacionService.java:69-167` (transiciones, cierre de pausa en `cerrar`/`cancelar`, auditoría `SESION_PAUSADA`/`SESION_REANUDADA`); `SessionWriteGuard.java:36-39` + `SesionPausadaException.java:4` (409 `SESION_PAUSADA`, `SESION_NO_ABIERTA`, `SESION_FINALIZADA`); migraciones `20261124000100/200`; tests `SesionAplicacionServiceTest`, `ParticipantRuntimePausaWebTest`, `PausaSesionSchemaIntegrationTest` | `backend-pausa-sesion-prompt.md` |
| B2 | PENDIENTE | No hay ruta de regeneración en `SessionController.java`; el token solo se emite en `ParticipantRuntimeService.java:81-115` | `backend-sesiones-instrumentos-prompt.md` §B2 |
| B3 | PARCIAL | `POST /sesiones/{id}/incidencias` existe (`SessionController.java:116`) y guarda en `auditoria` con acción `INCIDENCIA_SESION` (`ParticipantRuntimeService.java:267-276`); no hay `GET` | §B3 |
| B4 | PENDIENTE | `SessionManagementService.java:51-55` devuelve la entidad sin subtests ni nombres | prompt existente §B15.4 + §B4 |
| B5 | DESCARTADO | Opcional; el wizard persistido cubre el flujo | — |
| B6 | **HECHO** | `SubtestTimingService.java:35-146` (tiempo efectivo descontando pausas, gracia 5 s); `ParticipantRuntimeController.java:64-68` (`startedAt`, `timeLimitSeconds`, `remainingSeconds`, `paused`, `serverNow` al iniciar); `ParticipantEvaluationView.java:137,186-192` (`/yo`: `sessionStatus`, `pausedAt`, timing por subtest); `TiempoAgotadoException`; test `SubtestTimingServiceTest` | `backend-pausa-sesion-prompt.md` §7 |
| B7 | PENDIENTE | Solo `POST /test-versions/{id}/configuration` (`InstrumentController.java:57`); el builder arma el documento con `clone-template` por subtest | §B7 |
| B8 | PENDIENTE | Las subidas siempre cuelgan de un ítem/opción (`InstrumentController.java:170-213`); `ImageDraft.resourceId` ya existe en `VersionConfigurationRequest.java:33` | §B8 |
| B9 | PENDIENTE (puente) | `GET /subtests/{id}/clone-template` (`InstrumentController.java:88`) es el puente del frontend; no hay clonación de versión en el servidor | §B9 |
| B10 | PARCIAL | `/participantes` pagina sin filtros (`ParticipantController.java:25-30`); `/sesiones` usa `findAll()` (`SessionManagementService.java:47`); `/auditoria` solo filtra con `entity`+`entityId` juntos (`AuditController.java:18-27`) | §B10 |
| B11 | PARCIAL | `SessionAssignmentDto.java` documenta los enums, pero `ParticipantRuntimeService.java:278-355` los deriva a mano: asignación `ANULADO` con intento `COMPLETADO` sale `VENCIDO`; token vencido sin intento sale `GENERADO`; un `NO_INICIADO` saldría `no_iniciado` | §B11 |
| B12 | PENDIENTE | `SecurityPermissions.java:29` (`TEST_LEER` ignora `PERM_TEST_LEER`), `:36` (`SESION_LEER` ignora `PERM_SESION_LEER`); no existe `INSTRUMENTO_CATALOGO_LEER` | `backend-permisos-claves-intentos-prompt.md` §B12 |
| B13 | PENDIENTE | `InstrumentAdminService.java:641` ignora `answerKey.status == DELETED` | idem §B13 |
| B14 | PENDIENTE | `ResultController.java` no tiene `GET /attempts` | idem §B14 |
| B15 | PENDIENTE | `SessionManagementService.java:84-91` solo hace upsert | idem §B15 |
| B16 | PENDIENTE | `ParticipantController.java` sin `PUT` | idem §B16 |
| B17 | PENDIENTE | `ParticipantAnswerService.java:120` devuelve `RECHAZADA` solo en la respuesta del bulk-sync; no se persiste | §B17 |
| B18 | PENDIENTE | `UNIQUE` inmediatos en `supabase/migrations/20260621000100_create_bfa_schema.sql:274,317,347,359,370` | idem §B18 |
| B19 | PENDIENTE | `ReportController.java` sin `/reports/{id}/file` | idem §B19 |
| B20 | PARCIAL | `RecursoMultimedia` ya guarda `nombreArchivo`, `tamanoBytes`, `hashIntegridad` (`InstrumentImageService.java:254`), pero `SubtestCloneTemplateDTO.ImageTemplate` (l. 24) no los expone; sin `Idempotency-Key` | idem §B20 |
| B21 | PENDIENTE | `ParticipantAccessService.java:107-111` responde 409 `ASIGNACION_NO_OPERABLE` también en lectura para `COMPLETADO` | idem §B21 |
| B22 | PENDIENTE | `ClaveSimpleScoringService.java:150` solo compara `opcionCorrecta` | idem §B22 |
| B23 | PENDIENTE | `ClaveSimpleScoringService.java:157-160` cuenta pendientes sin crear `RevisionManualRespuesta`; `ManualReviewService.java:63-78` no recalcula el resultado | idem §B23 |

## Plan de ejecución

Cada tarea usa una BD aislada (`mkdb.sh <db> <migrations>`, con `BFA_DB_URL`). Eso permite paralelizar en worktrees las tareas que tocan servicios distintos.

| Prioridad | Tarea | B | Servicio principal | Migración reservada |
|---|---|---|---|---|
| P1 | T1 → T2 (secuencial) | B22 → B23 | `ClaveSimpleScoringService`, `ManualReviewService` | `20261126000200_revision_manual_unica.sql` (si hace falta) |
| P1 | T3 (en paralelo con T1/T2) | B13 + B18 | `InstrumentAdminService` | `20261126000100_orden_deferrable.sql` |
| P2 | T4 | B12 | `SecurityPermissions`, `InstrumentController`/servicio de catálogo | `20261125000100_rbac_catalogo_y_supervision.sql` |
| P2 | T5 | B14 | nuevo `AttemptQueryService` (reporting) | `20261126000300_idx_intento_estado_fin.sql` |
| P2 | T6 | B15 + B4 | `SessionManagementService` | — |
| P2 | T7 | B16 | `ParticipanteService` | — |
| P2 | T8 | B21 + B2 | `ParticipantAccessService`, `ParticipantRuntimeService` | — |
| P2 | T9 | B19 | `ReportRegistryService` | — |
| P3 | T10 | B3 + B17 + B11 | `ParticipantRuntimeService` (monitor), `ParticipantAnswerService` | `20261126000400_respuesta_rechazada.sql` |
| P3 | T11 | B20 + B8 | `InstrumentImageService`, `ItemImageStorageService` | `20261126000500_recurso_clave_subida.sql` |
| P3 | T12 | B7 + B9 | `InstrumentAdminService` (versión) | — |
| P3 | T13 | B10 | `ParticipanteService`, `SessionManagementService`, `AuditLogService` | — |
