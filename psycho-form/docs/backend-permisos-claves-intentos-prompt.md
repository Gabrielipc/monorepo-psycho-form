# Tarea backend: permisos por rol, borrado de claves e intentos para revisión

Proyecto: `psycho-form/psychoform` (Spring Boot, JPA, PostgreSQL; migraciones en `psycho-form/supabase/migrations`).
Son tres cambios independientes (B12, B13, B14) que necesita el refactor del frontend. Se pueden implementar y probar por separado.

---

## B12. Permisos del seed por rol

### Problema
1. **Aplicador** (`APLICADOR`) tiene `SESION_CREAR`, pero no puede elegir el instrumento de la sesión: `GET /tests`, `GET /tests/{id}/versions` y `GET /test-versions/{id}/subtests` exigen `SecurityPermissions.TEST_LEER` (= `PERM_TEST_CREAR or PERM_TEST_PUBLICAR`). Hoy el wizard de "Nueva sesión" devuelve 403 para el rol que lo usa.
   - **No** se resuelve dándole `TEST_LEER`. `GET /items/{id}/answer-key` acepta `TEST_LEER` (`InstrumentController` ≈ l. 247) y también lo aceptan items, opciones y clone-template, así que el Aplicador vería ítems confidenciales y claves. Hay que respetar el principio de mínimo privilegio.
2. **Psicólogo/Coordinador** (`PSICOLOGO_COORDINADOR`) no puede supervisar sesiones ni ver participantes: no tiene `SESION_*` ni `PARTICIPANTE_LEER`.
3. El permiso `TEST_LEER` existe en la tabla `permiso` (schema, l. ≈893) y el seed se lo asigna a Psicólogo. Pero la expresión Java `SecurityPermissions.TEST_LEER` **no comprueba `PERM_TEST_LEER`**, así que ese permiso no tiene efecto.

### Cambios
1. Nuevo permiso de **solo catálogo**: `INSTRUMENTO_CATALOGO_LEER`, "Listar tests, versiones publicadas y subtests para programar sesiones".
   - `SecurityPermissions.INSTRUMENTO_CATALOGO_LEER = "hasAuthority('PERM_INSTRUMENTO_CATALOGO_LEER') or " + TEST_LEER`.
   - Aplicarlo **solo** a `GET /tests`, `GET /tests/{id}/versions` y `GET /test-versions/{id}/subtests`.
   - Si el usuario **no** tiene `TEST_LEER` (solo catálogo):
     - `/tests/{id}/versions` devuelve únicamente las versiones `PUBLICADO`.
     - `/tests` devuelve solo los tests con al menos una versión `PUBLICADO`.
     - `/test-versions/{id}/subtests` responde 404 si la versión no está `PUBLICADO`.
   - El DTO de subtest **no** puede incluir ítems, opciones ni claves (verificarlo).
   - Items, opciones, imágenes, clone-template y answer-key siguen con su guard actual, sin cambios.
2. Hacer efectivo `TEST_LEER`: `SecurityPermissions.TEST_LEER = "hasAuthority('PERM_TEST_LEER') or hasAuthority('PERM_TEST_CREAR') or hasAuthority('PERM_TEST_PUBLICAR')"`.
   - Revisar si con esto algún rol gana acceso no deseado a `answer-key`. Hoy solo Psicólogo y Admin tienen `TEST_LEER`, así que no cambia nada.
3. Permiso explícito de lectura de sesiones: nuevo `SESION_LEER` en `permiso`, "Consultar sesiones, asignaciones y su progreso".
   - `SecurityPermissions.SESION_LEER = "hasAuthority('PERM_SESION_LEER') or hasAuthority('PERM_SESION_APLICAR') or hasAuthority('PERM_SESION_CREAR')"`.
4. Migración nueva `20261125000100_rbac_catalogo_y_supervision.sql`, idempotente (`ON CONFLICT`). Inserta los permisos nuevos y asigna:
   - `APLICADOR` += `INSTRUMENTO_CATALOGO_LEER`
   - `PSICOLOGO_COORDINADOR` += `SESION_LEER`, `PARTICIPANTE_LEER`, `INSTRUMENTO_CATALOGO_LEER`. **No** recibe `SESION_CREAR` ni `SESION_APLICAR`: supervisa, no opera.
   - `ADMINISTRADOR` recibe todos los permisos, como hoy.
   - Actualizar también `recrear_postgresql.sql` y `seed.sql` si listan permisos.
5. Con esto el Psicólogo puede llamar `GET /sesiones`, `/sesiones/{id}`, `/asignaciones`, `/pausas` y `/participantes`. **No** puede activar, pausar, cerrar, asignar, revocar ni registrar incidencias. Verificarlo.

### Tests
- `HttpSecurityIntegrationTest`, o uno nuevo, con un usuario por rol.
- Aplicador:
  - `GET /tests` → 200 y solo tests con versión publicada.
  - `GET /tests/{id}/versions` → solo `PUBLICADO`.
  - `GET /test-versions/{idBorrador}/subtests` → 404.
  - `GET /subtests/{id}/items` → 403.
  - `GET /items/{id}/answer-key` → 403.
- Psicólogo:
  - `GET /sesiones` → 200.
  - `POST /sesiones/{id}/activar` → 403.
  - `GET /participantes` → 200.
- Consultor: sin cambios. `GET /tests` → 403.

---

## B13. Borrar la clave de respuesta vía `/test-versions/{id}/configuration`

### Problema
En `InstrumentAdminService.persistDraftItems` (≈ l. 641), un `AnswerKeyDraft` con `status = DELETED` se **ignora**. No hay forma de quitar la clave de un ítem desde el editor (por ejemplo, al pasarlo a revisión manual). El resto de los nodos (`SubtestDraft`, `ItemDraft`, `OptionDraft`, `ImageDraft`) sí borran cuando `DELETED` llega con `id`.

### Cambios
1. Si `answerKey.status == DELETED` y `answerKey.id != null`, eliminar esa `ClaveRespuesta`. Antes, verificar que pertenece al ítem del draft; si no, `IllegalStateException`, que se traduce en 409.
2. `DELETED` sin `id` → no-op (igual que en los demás nodos).
3. Si en el mismo request el ítem trae `DELETED` y **otra** clave `CREATED` → 400 por conflicto. Va en `validateConfigurationRequest`.
4. Si al ítem se le borra la opción que era la correcta (`OptionDraft` `DELETED`) y su clave no viene `DELETED` ni reasignada → 400 con un mensaje claro. Hoy termina en `EntityNotFoundException`.
5. Mantener la exigencia de versión en `BORRADOR` (`requireDraft`).

### Tests
- Borrar una clave existente.
- `DELETED` sin `id`.
- Clave de otro ítem → 409.
- Conflicto `DELETED` + `CREATED` → 400.
- Borrar la opción correcta sin tocar la clave → 400.

---

## B14. Listado de intentos para calificación y resultados

### Problema
Las pantallas de **Calificar intentos** (Psicólogo, `CALIFICACION_EJECUTAR`) y **Resultados individuales** (Psicólogo y Consultor, `RESULTADO_VER`) solo pueden encontrar intentos recorriendo `GET /sesiones` y después `/sesiones/{id}/asignaciones`. Eso exige `SESION_LEER`, que el Consultor no tiene ni debe tener.

### Cambios
1. Nuevo endpoint `GET /attempts`, en `ResultController` o en un controller nuevo de reporting.
   - `@PreAuthorize(RESULTADO_VER + " or " + CALIFICACION_EJECUTAR)`.
   - Query params, todos opcionales:
     - `status`: `COMPLETADO|EN_PROGRESO|INTERRUMPIDO|ANULADO`.
     - `scored`: `true|false`, si ya tiene `Resultado`.
     - `sessionId`, `versionTestId`, `participantCode`.
     - `from`, `to`: fecha de finalización, ISO.
     - `page`, `size` (default 20, máx 100) y `sort` (default `finalizadoEn,desc`).
   - Respuesta: `PageResponse<AttemptSummaryDto>`, usando el `dto/PageResponse.java` existente.
     ```
     AttemptSummaryDto {
       attemptId, status, startedAt, finishedAt, totalTimeSeconds,
       participant: { id, code, fullName },
       session: { id, code, name },
       version: { id, testName, number },
       scored: boolean, resultId: Long|null, pendingManualReviews: int
     }
     ```
2. La consulta debe ser eficiente: una query con joins o una proyección, sin N+1. Agregar un índice si hace falta (`intento_test(estado, finalizado_en)`).
3. Auditoría: registrar la consulta como acceso a información sensible si el proyecto ya audita lecturas de resultados (revisar `AuditLogService`). Si no, no.

### Tests
- Filtros combinados.
- Paginación.
- Consultor → 200.
- Aplicador → 403.
- `scored=false` excluye los intentos con `Resultado`.

---

## Contrato que consumirá el frontend (resumen)
```
GET /tests, /tests/{id}/versions, /test-versions/{id}/subtests   permiso: INSTRUMENTO_CATALOGO_LEER | TEST_LEER
GET /sesiones/**  (lectura)                                      permiso: SESION_LEER | SESION_APLICAR | SESION_CREAR
POST /test-versions/{id}/configuration  answerKey.status=DELETED con id => borra la clave
GET /attempts?status&scored&sessionId&versionTestId&participantCode&from&to&page&size&sort -> PageResponse<AttemptSummaryDto>
Permisos nuevos visibles en /auth/me: INSTRUMENTO_CATALOGO_LEER, SESION_LEER
```
Al terminar, reportar los archivos modificados, las migraciones creadas y el resultado de `./mvnw test`.

---

## B15. `PUT /sesiones/{id}/subtests` debe reemplazar, no solo insertar o actualizar

### Problema
`SessionManagementService.replaceSubtests` solo inserta o actualiza las filas recibidas. Un subtest que se omite en el PUT sigue en la sesión, así que el frontend no puede quitar subtests ya guardados.

### Cambios
1. Dentro de la misma transacción (sesión `PROGRAMADA`, `findByIdForUpdate`), borrar las filas `sesion_subtest` de la sesión cuyo `subtestId` no venga en el request.
2. Validar que no haya `subtestId` ni `order` duplicados en el request: si los hay, 400.
3. Devolver las filas efectivas resultantes, ya ordenadas por `order`.
4. Exponer los subtests configurados en `GET /sesiones/{id}`, que es B4: `subtests: [{subtestId, code, name, order, timeLimitSeconds, randomizeItems, randomizeOptions}]`.

### Tests
- Omitir un subtest guardado lo elimina.
- Duplicados → 400.
- Sesión no `PROGRAMADA` → 409.

## B16. Edición de participantes

### Problema
`ParticipantController` no tiene ruta de actualización, así que el frontend no puede editar los datos de un participante.

### Cambios
1. Agregar `PUT /participantes/{id}` con `@PreAuthorize` del permiso de edición de participantes (o `PARTICIPANTE_CREAR` si no existe uno específico).
2. Campos editables: nombre(s), apellidos, correo, sexo, carrera, cohorte y grupo. El código no es editable.
3. Responder 409 si el correo o el código colisiona con otro participante.

### Tests
- Edición válida.
- Colisión → 409.
- Sin permiso → 403.

---

## B19. Descarga de reportes generados

### Problema
`ReportController` (`/reports`) solo expone `GET /reports`, `POST /reports/individual` y `POST /reports/aggregate`. Los tres devuelven el registro `ReporteGenerado`, con su `rutaAlmacenamiento`. No hay forma de descargar el archivo generado. El frontend ya tiene el helper de descarga (blob + `Content-Disposition`).

### Cambios
1. Agregar `GET /reports/{id}/file` con `@PreAuthorize(REPORTE_EXPORTAR)`.
2. Devolver el binario con `Content-Type` correcto (PDF/CSV/XLSX según el formato) y `Content-Disposition: attachment; filename="<nombre>"`, con el nombre codificado para RFC 5987 si tiene caracteres no ASCII.
3. Responder 404 si el registro no existe o el archivo ya no está en el almacenamiento.
4. Validar que `rutaAlmacenamiento` quede dentro del directorio de reportes, para evitar path traversal.
5. Si el proyecto ya audita descargas, registrar esta también.

### Tests
- Descarga válida con su nombre de archivo.
- Archivo inexistente → 404.
- Sin permiso → 403.
- Ruta fuera del directorio → 404.

---

## B18. Reordenar posiciones ocupadas en `/test-versions/{id}/configuration`

### Problema
Las restricciones `UNIQUE` de orden (subtests por versión, ítems por subtest, opciones por ítem) son inmediatas. Un intercambio de posiciones entre registros existentes, por ejemplo A:1↔B:2, falla en `persistDraft*` en cuanto se actualiza el primero. Por eso hoy el builder bloquea esos intercambios y solo ofrece revertir el reordenamiento.

### Cambios (elegir una opción)
1. **Recomendada:** declarar esas restricciones `DEFERRABLE INITIALLY DEFERRED`. Requiere una migración nueva que haga drop y create de cada constraint. Así la unicidad se valida al commit de la transacción de `/configuration`.
2. **Alternativa:** dentro de la misma transacción, mover primero a posiciones negativas o temporales los registros cuyo `order` cambia, y después asignar los definitivos.
3. En ambos casos `validateConfigurationRequest` debe seguir rechazando con 400 los duplicados del estado FINAL.

### Tests
- Intercambiar dos subtests, dos ítems o dos opciones en un solo request → 200 y orden final correcto.
- Una rotación de 3 elementos → 200.
- Un duplicado en el estado final → 400.
- Un fallo a mitad de la transacción → rollback completo, sin órdenes temporales persistidos.
