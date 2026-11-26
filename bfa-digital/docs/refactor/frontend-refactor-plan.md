# Plan de refactor del frontend: de demo a producción

Autor: Orquestador (Opus 5.5) · 2026-11-24
Alcance: `bfa-digital/src`. Las decisiones de estilo visual las define Gemini Neon en `ui-style-spec.md` (mismo directorio). Este plan cubre estado, integración con la API, rutas, contratos y lógica.

---

## 0. Diagnóstico general

| Área | Estado actual | Problema |
|---|---|---|
| Estado del servidor | Mezcla de 3 modelos: `adminStore` (zustand y fetch a mano), `useQuery` solo en el builder y `useEffect` con `setInterval` en las rutas | Caché duplicada, polling manual, `loading`/`error` globales compartidos por todas las pantallas |
| Auth | Un solo `authStore.token` para el staff **y** para el participante | Al validar un token de participante se pisa el JWT del admin en la misma pestaña o navegador. El interceptor hace logout ante **403** y redirige con `window.location` |
| Contratos | DTOs con nombres en español del backend mapeados a mano en cada store, `any` por todas partes, `ImageResourceDTO` con 15 alias de campo | Nada valida los datos que llegan, los mappers son frágiles |
| Restos de la demo | `App.tsx`, `screens/participant.tsx`, `admin-screens.tsx`, `admin-layout.tsx`, `login.tsx` (screen) sin uso; `simulationActive`/`tickSimulation`; `subtests: ['figuras','desplazamiento','espacial']` y `group: 'BFA - General'` hardcodeados; `adminService.getBackups/createBackup` simulados; contraseña `defaultPassword123!` en `createUser`; `roleId` hardcodeado 1..4; `console.log` del usuario en `app.tsx`; `TanStackRouterDevtools` también en producción | Comportamiento falso visible para el usuario y riesgo de seguridad |
| UX de errores | ~30 `alert()`/`confirm()` | No es aceptable en producción |
| Builder | `instrument-builder.tsx`, 3073 líneas. Clonar una versión dispara cientos de requests secuenciales desde el navegador | Imposible de mantener y no atómico (una falla a mitad deja datos corruptos) |

---

## 1. Actores y procesos

| Actor | Procesos principales | Rutas actuales |
|---|---|---|
| **Aplicador** | Crear sesión → configurar subtests → asignar participantes → distribuir accesos → abrir → monitorear en vivo → registrar incidencias → cerrar | `/app/sesiones`, `/nueva`, `/$id`, `/$id/asignaciones`, `/app/participantes` |
| **Participante** | Ingresar código → bienvenida → lista de subtests → instrucciones → responder ítems → finalizar subtest → resumen → finalizar evaluación | `/evaluacion/acceso`, `/evaluacion/$token/*` |
| **Psicólogo/Coordinador** | Crear test → versión → subtests → ítems/opciones/imágenes → claves y reglas → baremos → aprobar/publicar; calificar intentos; revisión manual; resultados | `/app/instrumentos/*`, `/app/calificaciones`, `/app/revision-manual`, `/app/resultados/*` |
| **Consultor** | Resultados agregados y reportes | `/app/dashboard-resultados`, `/app/reportes` |
| **Admin** | Usuarios, roles/permisos, auditoría, respaldos, catálogos | `/app/usuarios`, `/roles`, `/auditoria`, `/respaldos`, catálogos |

Prioridad del refactor (pedido del usuario): **P1 Sesiones**, **P2 Aplicación al participante**, **P3 Motor de creación de tests**. El resto queda en P4 (limpieza transversal).

---

## 2. Fundaciones transversales (F). Van antes que todo lo demás

### F1. Capa de datos única con TanStack Query
- Eliminar `adminStore` como caché del servidor. Zustand queda **solo** para estado de cliente: el draft del runner y las preferencias de UI.
- Estructura nueva:
  ```
  src/api/
    client.ts            // axios + interceptores (reemplaza axios.ts)
    errors.ts            // ApiError normalizado { status, code, message, details, correlationId }
    schemas/             // zod: un archivo por dominio (session.ts, assignment.ts, instrument.ts, runtime.ts…)
    endpoints/           // funciones puras tipadas por dominio (sessions.ts, participants.ts, instruments.ts, runtime.ts…)
  src/features/<dominio>/
    queries.ts           // queryOptions + keys (factory)
    mutations.ts         // useMutation con invalidaciones explícitas
    components/…
  ```
- Query keys con factory (`sessionKeys.detail(id)`, `sessionKeys.assignments(id)`), etc.
- Los loaders de TanStack Router usan `queryClient.ensureQueryData` para que no haya pantallas vacías mientras se hace el fetch.
- `QueryClient` con defaults de producción: `retry` en 0 para 4xx y hasta 2 para red, `staleTime` por dominio y `refetchOnWindowFocus` solo en el monitor.
- Validar cada respuesta con zod en `endpoints/*`. Si el parseo falla, se registra y se devuelve un `ApiError` legible. Los mappers de dominio (español → camelCase) viven junto al schema, en un solo lugar.

### F2. Auth separada por audiencia
- `staffAuth` (persistido, JWT de staff) y `participantAuth` (sessionStorage, ligado al `assignmentId`).
- Dos instancias de axios (`staffClient`, `participantClient`), cada una con su interceptor.
- Interceptor: **401** → limpiar sesión y redirigir con `router.navigate` (no `window.location`), guardando `redirect`. **403** → toast o pantalla `/no-autorizado`, **sin logout**.
- Leer `expiresAt` del login para programar un aviso "sesión por expirar" y un logout limpio.
- Hidratar `/auth/me` en `beforeLoad` de `/app` (no confiar solo en el storage).
- Permisos: guards de ruta basados en **permisos** (`hasPermission`), no en `roles[0]`. Hoy `role = user.roles[0]` ignora a los usuarios con varios roles. La navegación lateral se filtra por permiso.

### F3. UX de errores y feedback
- `sonner` para resultados de mutaciones, `<ConfirmDialog>` para acciones destructivas y `<ErrorState>`, `<EmptyState>` y skeletons ya presentes en `ui/` para las pantallas.
- Error boundary por ruta (`errorComponent`) y `notFoundComponent`.
- Prohibido `alert`/`confirm`/`console.log` (regla de lint).

### F4. Formularios
- `react-hook-form` + `zod` (ya instalados) en todos los formularios: sesión, participante, usuario, catálogos e ítems del builder. Validación inline, sin validaciones imperativas con `alert`.

### F5. Limpieza
- Borrar `App.tsx`, `screens/participant.tsx`, `screens/admin-screens.tsx`, `admin-layout.tsx`, `screens/login.tsx` y `imports/pasted_text` tras verificar que no tienen imports.
- Quitar MUI/emotion si no se usan (verificar con grep), además de `react-slick`, `react-responsive-masonry`, `canvas-confetti` y otras dependencias de Figma Make que no estén en uso.
- Renombrar el package (`@figma/my-make-file` → `bfa-digital`) y agregar los scripts `typecheck`, `lint`, `test`.
- Devtools solo con `import.meta.env.DEV`.
- Tooling: ESLint + `tsc --noEmit` en CI, Vitest + Testing Library + MSW para tests de features.

---

## 3. P1: Gestión de sesiones (aplicador)

### Modelo de estados (fuente: backend)
```
Sesión:      PROGRAMADA ──activar──▶ ABIERTA ──cerrar──▶ CERRADA
                 │                      │
                 └──────cancelar────────┴──▶ CANCELADA (terminal)
Asignación:  ASIGNADO → EN_PROGRESO → COMPLETADO | ANULADO | EXPIRADO
Intento:     NO_INICIADO → EN_PROGRESO → COMPLETADO | INTERRUMPIDO | ANULADO
```

### Bugs actuales a corregir
1. **Crítico:** "Pausar" llama a `/cancelar`, que deja la sesión en CANCELADA (terminal), y "Reanudar" llama a `/activar`, que exige PROGRAMADA, así que falla. El frontend inventa los estados `PAUSADA`/`ACTIVA`/`FINALIZADA`.
   → Usar los enums reales del backend. Eliminar "Pausar" hasta que exista en el backend (ver §6, B1). "Cancelar" pasa a ser una acción destructiva con confirmación.
2. El estado de la asignación en el frontend (`GENERADO/ACTIVO/VENCIDO/REVOCADO`) no coincide con el enum del backend (`EstadoAsignacion`). Hoy `SessionAssignmentDto` lo traduce a texto libre. → Tipar como unión literal validada por zod y acordar el contrato con el backend.
3. El token crudo se guarda en `localStorage` (`generatedTokens`) y se pierde en otro dispositivo, porque el monitor muestra `id-***`. → El token solo se muestra **una vez** al generarlo (modal con copiar, QR e imprimir). Si se pierde, se usa la acción **"Regenerar acceso"** (B2). Nunca se persiste en el cliente.
4. Las incidencias solo existen en el `localStorage` del navegador que las creó. → Hace falta un endpoint de listado (B3) y la vista lo consume.
5. Los subtests y el grupo están hardcodeados en `fetchSessions`. → Usar los datos reales (B4: `GET /sesiones/{id}` con detalle).
6. La creación de la sesión hace N+2 requests secuenciales y no es atómica. Si falla una asignación, la sesión queda a medias. → Wizard con pasos persistidos en el servidor (la sesión se crea como PROGRAMADA en el paso 1 y los pasos siguientes la editan) o un endpoint compuesto (B5). Recomiendo el wizard persistido, que es más simple y reanudable.

### Diseño de pantallas y flujos
- `/app/sesiones`: tabla con filtros (estado, fecha, versión), búsqueda y paginación del servidor cuando exista. Acciones por fila según el estado.
- `/app/sesiones/nueva`: wizard de 4 pasos → **Datos** (nombre, código autogenerado editable, ventana inicio/fin, ubicación) → **Instrumento** (test → versión PUBLICADO únicamente → subtests con orden, tiempo y aleatorización, con valores tomados de la versión) → **Participantes** (selección múltiple con filtros por carrera, cohorte y grupo, y "agregar todo el grupo") → **Revisión**. Al finalizar se muestra la hoja de accesos (§ tokens).
- `/app/sesiones/$id`: una sola página con pestañas **Monitor | Participantes y accesos | Incidencias | Configuración**. Hoy asignaciones es otra ruta: se mantiene como ruta hija para tener deep-link, pero se presenta como pestaña.
  - Monitor: `useQuery` con `refetchInterval` de 5 s **solo si** la sesión está ABIERTA y la pestaña es visible. KPIs derivados con `select`.
  - Acciones de sesión, `useSessionTransitions(session)` → `{ canOpen, canClose, canCancel }` derivado de una tabla de transiciones única, compartida por botones y menús.
  - Acciones por participante: anular o revocar acceso, regenerar acceso, nota de incidencia, ver respuestas y calificar (deep-link a `/app/calificaciones?attemptId=`).
- Hoja de accesos: imprimible/exportable con nombre, código y enlace `/evaluacion/{assignmentId}-{token}` (y QR, sin dependencias nuevas salvo aprobación).

### Contratos frontend (zod)
`Session { id, code, name, description?, status: EstadoSesion, scheduledStart, scheduledEnd, location?, versionTest: {id, testName, number}, subtests: SessionSubtest[], counts: {...} }`
`Assignment { assignmentId, attemptId|null, participant:{id, code, name}, assignmentStatus, attemptState, currentSubtest?:{id,name}, progress:0..100, lastActivityAt?: ISO, tokenExpiresAt?: ISO }`

---

## 4. P2: Aplicación al participante (runner)

### Problemas actuales
- `getItem` descarga **todos** los ítems del subtest en cada navegación y busca por ordinal.
- Solo se soporta `OPCION_UNICA`. Los tipos `OPCION_MULTIPLE`, `VERDADERO_FALSO`, `NUMERICA` y `TEXTO_ABIERTO` existen en el modelo pero no tienen UI.
- El cronómetro es 100 % cliente (`timeLeft` en localStorage): se reinicia al volver a instrucciones y se puede manipular. `timeUsedSeconds: 1` está hardcodeado y `finishSubtest` envía 0.
- `answers` usa como key `slug-itemId` y es global: si un participante entra en el mismo navegador que otro, se mezclan las respuestas (no se limpia por `assignmentId`).
- Con la cola offline se bloquea la finalización mediante `alert`. Si se acaba el tiempo con respuestas pendientes, el subtest no se finaliza nunca.
- La URL contiene el token crudo (`/evaluacion/{id-token}/…`) en todas las rutas, así que queda en el historial y en los logs.
- No hay guard de orden: se puede entrar por URL a un subtest COMPLETADO o saltarse el orden.
- El estado `PAUSADA` que verifica el layout no existe en el backend.

### Diseño objetivo
- **Entrada:** `/evaluacion/acceso?code=` → valida → guarda el JWT de participante en `participantAuth` → `router.navigate('/evaluacion/sesion')`. El token deja de estar en la URL (si llega por enlace, se canjea y se reemplaza con `replace`).
- **Máquina de estados del runner** (reducer puro, testeable, en `features/runtime/machine.ts`):
  `validando → bienvenida → listaSubtests → instrucciones(s) → respondiendo(s, i) → finalizandoSubtest(s) → listaSubtests → resumen → finalizando → completada`
  con estados laterales `bloqueado(sesionCerrada|accesoRevocado|expirado)` y `sinConexion`.
- **Datos:** una query `runtime.evaluation` (`/evaluacion-participante/yo`) como fuente de verdad del estado por subtest, y una query por subtest con **todos** sus ítems (`/intentos/{a}/subtests/{s}/items`). La navegación entre ítems es local e instantánea, porque no hay fetch por ítem. Imágenes con prefetch del siguiente ítem (`AuthenticatedImage` con caché por URL en Query).
- **Ruta de ítem:** `/evaluacion/subtests/$subtestId/items/$ordinal` (ordinal numérico, validado con `params.parse`). Un guard en `beforeLoad` redirige si el subtest no está habilitado o ya está completado.
- **Respuestas:** store zustand `runtimeDraft` con key `assignmentId` (`answers[itemId] = AnswerValue`), donde `AnswerValue` es una unión discriminada por `TipoRespuesta`. Cola de sincronización con reintentos con backoff, idempotente por `itemId`. Se vacía con `bulk-sync`. Se limpia al completar o al cambiar de asignación.
- **Renderers por tipo de respuesta:** `OptionSingle`, `OptionMulti`, `TrueFalse`, `Numeric`, `OpenText` registrados en un mapa `TipoRespuesta → componente`. Teclado: A–D/1–4 seleccionan y ←/→ navegan.
- **Tiempo:** el servidor es la autoridad. `iniciar subtest` debe devolver `startedAt` y `timeLimitSeconds` (B6). El cliente calcula `deadline = startedAt + limit` y muestra la cuenta regresiva desde allí, así que recargar la página no reinicia el tiempo. Al llegar el deadline: flush de la cola → finalizar (aunque falle la cola, el backend cierra por tiempo). `timeUsedSeconds` por ítem se mide de verdad con los timestamps de entrada y salida.
- **Mapa de ítems** del subtest (respondidos, pendientes, actual) y resumen previo a finalizar con los ítems sin responder.
- **Modo examen:** advertencia en `beforeunload`, bloqueo de menú contextual y arrastre en recursos (ya existe), sin enlaces de salida durante `respondiendo`.

---

## 5. P3: Motor de creación de tests

### Problema central
El modelo del backend es granular (Test → Versión → Subtest → Ítem → Opción → Imagen, más ReglaCalificación → ClaveRespuesta, más Baremo → Rango) y el builder lo recorre con una request por entidad. Ya existe un endpoint de borrador agregado, **`POST /test-versions/{id}/configuration`** (`VersionConfigurationRequest` con `draftId`, `status` EXISTING/CREATED/UPDATED/DELETED y anidamiento completo hasta la clave de respuesta), pero se usa solo parcialmente: el guardado de ítems (`saveItemDraft`), las reglas, las claves y la clonación de versión (`CreateVersionDialog`, ~200 líneas de requests en cascada) siguen yendo entidad por entidad.

### Diseño objetivo: "documento de versión"
- Un solo modelo de cliente, el **`VersionDocument`**: el árbol completo de la versión (subtests → ítems → opciones → imágenes → clave), cada nodo con `{ id?, draftId, status }`. Es exactamente la forma de `VersionConfigurationRequest`.
- **Carga:** un solo `GET` del documento (B7: `GET /test-versions/{id}/configuration`; mientras no exista, se arma con un adaptador que hace las llamadas actuales en paralelo, encapsulado en un solo archivo para borrarlo después).
- **Edición:** store zustand por versión abierta (`builderStore`) con reducer de operaciones (`addSubtest`, `moveItem`, `setCorrectOption`, `attachImage`…), `dirty` por nodo, undo/redo simple y autosave del borrador en `localStorage` por `versionId` para no perder trabajo.
- **Guardado:** un solo `POST /configuration` con el diff (los nodos con status ≠ EXISTING). Las imágenes nuevas se suben antes como recursos (`resourceId`) y el documento solo las referencia (B8: endpoint de subida de recurso suelto, si no existe).
- **Validación en cliente** con zod sobre el documento: cada ítem de opción tiene ≥2 opciones y exactamente 1 correcta en OPCION_UNICA, códigos únicos por nivel, tiempos > 0, etc. El panel de "problemas" lista errores por nodo y bloquea "Aprobar/Publicar".
- **Clave de respuesta integrada:** en el editor de ítem, marcar la opción correcta *es* la clave. La regla `CLAVE_ITEM` del subtest se crea implícitamente. El usuario no ve "reglas", "estrategias" ni IDs salvo en modo avanzado.
- **Plantillas por tipo de ítem** (BFA: comparación de imágenes, desplazamiento, espacial): preconfiguran `tipoItem`, `tipoRespuesta`, el número de opciones y el layout de imágenes.
- **Versionado:** las versiones PUBLICADO y RETIRADO (y las que no estén en BORRADOR, porque el backend exige BORRADOR para guardar) son de solo lectura en la UI. "Nueva versión desde…" usa un endpoint de clonación del servidor (B9: `POST /test-versions/{id}/clone`). Mientras no exista, se usa `GET` del documento → remapear ids a `draftId` → `POST /configuration` en la versión nueva, que son 2 requests en lugar de cientos.
- **Flujo de publicación:** BORRADOR → (validación OK) Aprobar → Publicar, con un diálogo de revisión que muestra el conteo de subtests, ítems y claves, y las advertencias. Las sesiones solo pueden elegir versiones PUBLICADO.
- **Vista previa como participante:** reutiliza los renderers del runner (§4) en modo `preview` sin API. Es la razón de que los renderers sean componentes puros.
- **Descomposición del archivo de 3073 líneas:**
  ```
  features/instruments/
    document/ (types.ts, schema.ts, reducer.ts, diff.ts, adapters.ts)
    builder/  (BuilderLayout, OutlineTree, SubtestPanel, ItemEditor, OptionList, ImageField, AnswerKeyField, ProblemsPanel, PublishDialog)
    baremos/  (BaremoEditor, RangeTable)
    versions/ (VersionList, NewVersionDialog)
    preview/  (PreviewRunner)
  ```

---

## 6. Dependencias del backend (a coordinar; fuera del alcance de este refactor)

| ID | Necesidad | Bloquea |
|---|---|---|
| B1 | **Decidido: sí hay pausa.** Spec en `psycho-form/docs/backend-pausa-sesion-prompt.md` (estado `PAUSADA`, `/pausar`, `/reanudar`, tiempo congelado, 409 `SESION_PAUSADA`). Incluye B6 | §3 bug 1. El frontend se implementa contra ese contrato; hasta que el backend esté listo, el botón queda oculto tras un feature flag |
| B2 | `POST /sesiones/{id}/asignaciones/{aid}/regenerar-token` | Tokens sin persistencia en el cliente |
| B3 | `GET /sesiones/{id}/incidencias` | Bitácora real |
| B4 | `GET /sesiones/{id}` ya existe, pero **no** trae los subtests configurados (`sesion_subtest`) ni el nombre del test y de la versión. Hace falta incluirlos o exponer `GET /sesiones/{id}/subtests` | Al reanudar el wizard se pierde la configuración de subtests guardada, y el detalle muestra "Versión #id" |
| B5 | (opcional) creación compuesta de sesión | Alternativa al wizard persistido |
| B6 | `startedAt`/`deadline` en iniciar subtest y en `/yo` | Cronómetro autoritativo |
| B7 | `GET /test-versions/{id}/configuration` (documento completo) | Carga del builder en 1 request |
| B8 | Subida de imagen como recurso suelto que devuelve `resourceId` | Guardado atómico del documento |
| B9 | `POST /test-versions/{id}/clone` | Clonación atómica |
| B10 | Paginación y filtros en `/participantes`, `/sesiones`, `/auditoria` | Tablas de producción |
| B11 | Contratos de enum coherentes en `SessionAssignmentDto` (`status`/`state`) | Tipado estricto |
| B12 | **Prompt listo:** `psycho-form/docs/backend-permisos-claves-intentos-prompt.md` (B12 a B14). Al implementarse, el frontend debe sumar `SESION_LEER` e `INSTRUMENTO_CATALOGO_LEER` en `routePermissions.ts` y en el paso Instrumento del wizard. Seed RBAC: el rol Aplicador no tiene lectura de tests (`GET /tests`), que hace falta para elegir instrumento al crear una sesión. El rol Psicólogo no tiene `SESION_*` ni `PARTICIPANTE_LEER` (pendiente de decisión del usuario) | Wizard de sesión (S-03) para Aplicador |
| B13 | Borrar la clave de respuesta vía `/configuration`: hoy un `AnswerKeyDraft` con `DELETED` se ignora | Quitar la clave de un ítem en el builder |
| B14 | Fuente de intentos para Psicólogo/Consultor que no dependa de `GET /sesiones` (p. ej. `GET /attempts?status=COMPLETADO`) | Calificaciones y resultados individuales por rol |
| B15 | **Prompt listo** (mismo archivo). `PUT /sesiones/{id}/subtests` debe borrar los subtests omitidos y `GET /sesiones/{id}` debe exponerlos (B4). Mientras tanto, el wizard bloquea el desmarcado de subtests ya guardados | Quitar subtests de una sesión programada |
| B16 | **Prompt listo** (mismo archivo). `PUT /participantes/{id}` | Edición de participantes (cierre de S-05) |
| B17 | `GET /sesiones/{id}/asignaciones` (`SessionAssignmentDto`, permiso `SESION_LEER`): hoy `ParticipantAnswerService.bulkSyncAnswers` devuelve rechazos `RECHAZADA` solo en la respuesta síncrona al participante sin persistirlos ni exponerlos al staff. Agregar campos opcionales aditivos `rejectedAnswersCount` (`Integer`) y `rejectedAnswers` (`[{ itemId, code, rejectedAt }]`) en `SessionAssignmentDto` para visibilidad en tiempo real en el monitor | Indicador en vivo de respuestas rechazadas en `SessionMonitorTab` |
| B18 | **Prompt listo** (`psycho-form/docs/backend-permisos-claves-intentos-prompt.md`). Las restricciones SQL de orden son únicas e inmediatas. El guardado agregado necesita aplicar reordenamientos de registros existentes sin colisiones dentro de la transacción | Guardar permutaciones de posiciones ya ocupadas |
| B19 | **Prompt listo** (`psycho-form/docs/backend-permisos-claves-intentos-prompt.md`). `GET /reports/{id}/file` (`REPORTE_EXPORTAR`) que devuelva el binario con `Content-Disposition`. Hoy `/reports` solo registra `ReporteGenerado` con `rutaAlmacenamiento` | Descargar reportes desde `/app/reportes` (el helper `src/api/download.ts` ya existe) |

Todo lo de §3 a §5 tiene una variante "puente" que funciona con la API actual, encapsulada en `api/endpoints/*` o `document/adapters.ts`, para no bloquear el frontend.

---

## 7. Fases y tareas atómicas (para delegar)

Convención: cada tarea tiene **entrada**, **salida**, **criterio de aceptación**. `S` = Sonnet 5.5 (secuencial), `G` = Gemini Hydrogen (swarm paralelizable), `N` = Gemini Neon (estilo).

**Fase 0: Fundaciones (bloqueante)**
- F-01 S · Tooling: eslint, typecheck, vitest, MSW, scripts y rename del package. *AC:* `npm run typecheck && npm run lint && npm test` en verde.
- F-02 S · `api/client.ts`, `errors.ts`, clientes staff y participante, interceptores 401/403. *AC:* tests con MSW de 401 → redirect y 403 → sin logout.
- F-03 S · Auth: `staffAuth`/`participantAuth`, hidratación de `/auth/me` y guards por permiso. *AC:* login de participante en otra pestaña no afecta la del staff.
- F-04 N · Aplicar los tokens de `ui-style-spec.md` en `theme.css` y crear los componentes `StatusBadge`, `PageHeader`, `ConfirmDialog`, `DataTable`. *AC:* cero colores crudos en los componentes base.
- F-05 G (swarm) · Schemas zod + endpoints por dominio: sessions, participants, catalogs, runtime, instruments, results, admin. *AC:* cada endpoint tipado, sin `any`, con test de parseo con fixtures reales.
- F-06 S · Limpieza de código muerto y dependencias (tras F-05).

**Fase 1: Sesiones**
- S-01 S · `features/sessions/queries|mutations`, tabla de transiciones y `useSessionTransitions`. *AC:* tests unitarios de transiciones contra los enums del backend.
- S-02 S · Lista de sesiones con filtros.
- S-03 S · Wizard de creación (persistido) con RHF+zod.
- S-04 S · Detalle con pestañas: monitor con polling condicional, accesos (token una sola vez, hoja de accesos) e incidencias.
- S-05 S · Participantes: lista, alta y edición con RHF y asignación masiva por grupo.

**Fase 2: Runner**
- R-01 S · Máquina de estados del runner y tests exhaustivos (reducer puro).
- R-02 S · `runtimeDraft` store con key por asignación, cola de sincronización con backoff y tests.
- R-03 G (swarm) · Renderers por `TipoRespuesta` (5, independientes) + navegación por teclado. *AC:* storybook-like en `/dev/renderers` solo en DEV, o tests de RTL.
- R-04 S · Rutas nuevas sin token en la URL, guards de orden y cronómetro por deadline.
- R-05 N · Estilo de modo examen según la spec.

**Fase 3: Builder**
- B-01 S · `VersionDocument` (types, schema, reducer, diff) y tests (diff → `VersionConfigurationRequest`).
- B-02 S · Adaptador de carga puente y `builderStore` con autosave.
- B-03 G (swarm) · Componentes del builder (OutlineTree, ItemEditor, OptionList, ImageField, AnswerKeyField, BaremoEditor), cada uno contra el contrato del reducer.
- B-04 S · Guardado agregado de la estructura, panel de validación y flujo de aprobación y publicación. El adaptador usa llamadas separadas para metadatos, reglas nuevas, imágenes pendientes y baremos, según los endpoints disponibles.
- B-05 S · Nueva versión desde una versión existente mediante el adaptador puente y vista previa con los renderers de R-03. La clonación completa requiere los endpoints de creación, configuración y los recursos asociados. Si un paso falla tras crear la versión, el editor abre el borrador parcial y muestra el error.
- B-06 S · Borrar `instrument-builder.tsx`.

**Fase 4: Resto** (resultados, calificación, revisión manual, reportes, admin, catálogos): migrar a Query + RHF, quitar los simulados de respaldos (o esconderlos tras un feature flag hasta que el backend responda) y eliminar la contraseña hardcodeada (generar una temporal en el backend o pedirla en el formulario).

**Validación:** al cerrar cada fase, revisión de GPT 6.2 (dictamen APROBADO / CAMBIOS REQUERIDOS) contra este documento. Para el cierre de la fase 3, el usuario indicó que se hicieran únicamente comprobaciones locales.

---

## 7b. Backlog de auditoría asignado a fases (re-auditoría GPT 6.2, Fase 0)

Hallazgos en código legacy que su fase **reemplaza** (no se parchean en Fase 0, pero el criterio de aceptación de la fase los incluye):

| Fase | Hallazgo |
|---|---|
| F1 (sesiones) | `adminStore` acepta escrituras tardías de la cuenta saliente → se elimina (Query con claves por sesión). `/app/sesiones/$id/asignaciones` no renderiza porque el padre no tiene `Outlet` → pestañas. `/app/sesiones/nueva` con guard `SESION_CREAR`. Agregar y revocar requieren `SESION_APLICAR`. Participantes no debe esperar a los catálogos para listar. Reemplazar `confirm()` nativos |
| F2 (runner) | Las escrituras tras `await` deben verificar la asignación y el intento de origen. Cancelar los efectos de la ruta anterior. Revocar las URL `blob:` creadas. Avisar cuando se descarta la cola de otro participante. El `catch` de `routes/evaluacion/$token.tsx` debe ignorar `STALE_PARTICIPANT`. Mostrar `rejectedAnswers` al participante y al monitor. Si `bulk-sync` falla entero con 4xx, no dejar la cola en offline para siempre. Acotar el reintento de `SUBTEST_NO_INICIADO`. Fechas de `runtime.ts` con `serverDateTime` (conventions §10): startedAt, pausedAt, iniciadoEn, finalizadoEn, ultimaActividadEn, respondidoEn |
| F3 (builder) | `/scoring/strategies` exige `CALIFICACION_CONFIGURAR`: condicionar la consulta y los controles de escritura por permiso. Fechas de `instruments.ts` con `serverDateTime` (creadoEn, aprobadoEn, publicadoEn, fechaCreacion) |
| F4 (resto) | `/app/revision-manual` usa una URL vieja (`GET /manual-review/pending` admite `RESULTADO_VER`). `/app/dashboard-resultados` llama `/resultados/dashboard` (no existe; usar `/analytics/results` y `/dashboard/overview`). `/app/reportes` llama `/reportes/descargar` (no existe) y tiene acciones sin el permiso `REPORTE_EXPORTAR`. Calificaciones y resultados dependen de `/sesiones` (B14). Feedback de error en Descargar respaldo y Exportar PDF. F-06 (dependencias sin uso). **Decisión del orquestador:** `/app/carga-imagenes` se retira, porque la carga de imágenes de ítems y opciones vive en el builder de la Fase 3. La ruta redirige a `/app/instrumentos` y se quita el enlace de `InstrumentList.tsx`. **Calificar desde el Monitor:** el Monitor ya envía `?sessionId&attemptId`. La nueva pantalla de calificación (sobre B14 `GET /attempts`) debe abrir ese intento directamente. El puente provisional en `calificaciones.tsx`/`adminStore` deja abiertos estos casos de la auditoría de Fase 1 (re-verificación 4): falta reintentar cuando falla la lista de sesiones; «Actualizar» y «Calificar» se habilitan antes de validar la sesión elegida desde la caché; una respuesta tardía de `fetchSessions` desincroniza el selector. Se resuelven al reemplazar la pantalla, no parcheando la legacy. Fechas de `academic.ts`, `admin.ts` y `results.ts` con `serverDateTime` (`fechaNacimiento` es solo fecha: no aplicar) |

## 8. Riesgos
- Las dependencias del backend (§6) pueden atrasar la limpieza de los adaptadores puente. Se mitiga encapsulándolos.
- Migrar el runner en medio de un ciclo de aplicación real: se libera detrás de la ruta nueva y la vieja se mantiene una iteración.
- Datos existentes con estados que el frontend no conoce: zod con `catch` hacia `DESCONOCIDO` y un badge neutral, sin crashear.
