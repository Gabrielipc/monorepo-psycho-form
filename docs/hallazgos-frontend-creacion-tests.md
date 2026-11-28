# Hallazgos: brechas del frontend para crear tests sin SQL

Estado al 2026-11-28, después de la rama `feat/scoring-strategies` (arquitectura de estrategias de calificación, endpoints de dimensiones y matriz, criterios normativos de baremos).

Este documento reúne lo que el backend ya soporta pero el frontend (`bfa-digital`) todavía no expone, junto con las validaciones del frontend que contradicen al backend. Mientras estos puntos sigan abiertos, algunas configuraciones de un test solo se pueden hacer con llamadas directas a la API o con SQL. El objetivo es que un test completo se cree desde la interfaz.

Cada hallazgo indica severidad, evidencia, impacto y qué hay que implementar. Las severidades son:

| Severidad | Significado |
| :--- | :--- |
| **Alta** | Impide crear o publicar un test válido desde la UI, o lo publica con resultados incorrectos. |
| **Media** | El test se puede crear, pero sin una capacidad que el backend ya soporta (escalas, normas). |
| **Baja** | Problema de claridad o de ergonomía. |

---

## F1. Validación de claves desactualizada que bloquea tipos de respuesta válidos. Severidad: alta

**Evidencia:** `bfa-digital/src/features/instruments/document/schema.ts`, constante `UNSUPPORTED_SCORING_KEY_MESSAGE` y el bloque que la emite con `severity: "error"`. El comentario dice que la calificación "solo puntúa si la clave tiene una única opción correcta" y que "ignora el texto/valor esperado".

**Realidad del backend:** `ClaveCorrectnessEvaluator` (usado por la estrategia `CLAVE_SIMPLE`) califica:
- `OPCION_MULTIPLE` por conjunto exacto: filas de `clave_respuesta_opcion`, o códigos separados por coma en `texto_esperado`, o la opción singular.
- `NUMERICA` con `valor_numerico_esperado` ± `tolerancia_numerica`.
- `TEXTO_ABIERTO` con `texto_esperado` normalizado (sin acentos, mayúsculas, espacios colapsados).

**Impacto:** la UI marca como error de publicación claves que el backend califica bien. Hoy no se puede publicar desde la interfaz un test con ítems numéricos, de texto o de selección múltiple sin revisión manual.

**A implementar:**
- Eliminar `UNSUPPORTED_SCORING_KEY_*` y alinear las reglas con `ClaveSimpleScoringStrategy.validateConfiguration`:
  - NUMERICA requiere valor esperado.
  - TEXTO_ABIERTO requiere texto esperado.
  - OPCION_MULTIPLE requiere conjunto, códigos u opción correcta.
  - OPCION_UNICA y VERDADERO_FALSO requieren opción correcta.
  - En todos los casos, salvo que el ítem esté marcado para revisión manual.
- Actualizar los tests de `document/__tests__`.

## F2. Falta validar en la UI que cada ítem tenga clave. Severidad: alta

**Realidad del backend:** al publicar una versión `CLAVE_SIMPLE`, el backend rechaza (409) la publicación si algún ítem activo no tiene clave oficial o si la clave no es coherente con su tipo de respuesta. Devuelve un mensaje que lista subtest e ítem.

**Impacto:** el usuario descubre el problema recién al pulsar publicar. `PublishDialog` muestra el texto del error, pero no lleva al ítem afectado.

**A implementar:**
- En `schema.ts`, un problema `MISSING_ANSWER_KEY` (severidad error, nodo del ítem) cuando la estrategia de la versión sea `CLAVE_SIMPLE`.
- Mostrar la lista de problemas del 409 en `PublishDialog` separada por `;`. El backend la envía con el formato `La version no se puede publicar: p1; p2`.

## F3. No hay UI para dimensiones de resultado (escalas). Severidad: media

**Backend disponible:**

| Método | Ruta |
| :--- | :--- |
| GET | `/test-versions/{id}/dimensions` |
| POST | `/test-versions/{id}/dimensions` |
| PATCH | `/dimensions/{id}` |
| DELETE | `/dimensions/{id}` |

- Body de alta: `{code, name, description?, subtestId?, order, minScore?, maxScore?, active?}`.
- Lectura: `codigoDimension`, `nombreDimension`, `subtestId`, `ordenPresentacion`, `puntajeMinimo`, `puntajeMaximo`, `activa`.
- El DELETE responde 409 si la dimensión está referenciada; en ese caso hay que desactivarla con `active=false`.

**Impacto:** sin dimensiones, el resultado solo tiene puntaje total: no hay puntajes por escala ni baremos por escala. Con `CLAVE_SIMPLE`, una dimensión asociada a un subtest recibe automáticamente la suma de sus ítems, aunque no haya matriz.

**A implementar:**
- Un panel "Escalas" en el builder de la versión: lista, alta y edición, y asociación opcional a un subtest.
- Ofrecer "crear una escala por subtest" como acción rápida.

## F4. No hay UI para la matriz opción-dimensión. Severidad: media

**Backend disponible:** `GET` y `PUT /scoring-rules/{id}/option-scores`.
- El PUT reemplaza el conjunto completo con `{rows:[{optionId, dimensionId, score, weight?, active?}]}`.
- La lectura devuelve `opcionId`, `dimensionResultadoId`, `puntaje`, `peso`, `activa`.

**Impacto:**
- No se pueden configurar tests donde cada opción aporta a varias escalas (inventarios, intereses, personalidad).
- `adapters.ts` omite las reglas `OPCION_DIMENSION` al reutilizar subtests, con el mensaje "sin endpoints disponibles para copiarla". Ese mensaje ya no es cierto.

**A implementar:**
- Un editor de matriz por regla, con una grilla de opciones del ítem × escalas.
- Copiar la matriz al reutilizar un subtest (en `adapters.ts`, el plan de copia de reglas `OPCION_DIMENSION`).

## F5. El editor de baremos no expone dimensión ni criterios normativos. Severidad: media

**Evidencia:** `baremos/BaremoEditor.tsx` solo edita código, nombre, grupo normativo y descripción. `adapters.ts` documenta que solo se copian baremos totales (`dimensionId === null`).

**Backend disponible:**
- `POST /baremos` y `PATCH /baremos/{id}` aceptan `dimensionId`, `minAge`, `maxAge`, `sexId`, `careerId`, `validFrom` y `validTo` (rama `feat/scoring-strategies`).
- Al calificar, `BaremoResolver` elige el baremo más específico que aplica al perfil del participante: edad, sexo y carrera registrados en la asignación, más la fecha de aplicación.

**Impacto:** desde la UI no se pueden cargar normas por edad o por sexo, ni baremos por escala. Si se cargan varios baremos totales sin criterios, gana el aprobado más reciente.

**A implementar:**
- Campos de escala (select de dimensiones de la versión), edad mínima y máxima, sexo y carrera (catálogos), y vigencia desde/hasta.
- Copiar baremos por dimensión al reutilizar subtests o versiones.

## F6. Selector de estrategia por subtest engañoso. Severidad: baja

**Evidencia:** `builder/SubtestPanel.tsx` ofrece una estrategia por subtest ("Heredar de la versión").

**Realidad del backend:** la estrategia que califica es la de la **versión** (`version_test.estrategia_calificacion_id`). La del subtest solo llega a la estrategia como dato informativo (`SubtestSnapshot.strategyCode`); ninguna implementación actual la usa.

**A implementar:** quitar el selector o rotularlo como informativo hasta que exista una estrategia que lo interprete.

## F7. El selector de estrategias no distingue las que tienen implementación. Severidad: baja

**Backend disponible:**
- `GET /scoring/strategies` incluye el campo `implemented`.
- Publicar una versión cuya estrategia no tiene implementación responde 409.

**Impacto:** el usuario puede elegir `LIKERT_ESCALA`, `MATRIZ_DIMENSIONAL` u otras sin implementación, y solo lo descubre al publicar.

**A implementar:**
- Agregar `implemented` a `ScoringStrategyWireSchema` (el esquema es `.loose()`, así que hoy el campo se descarta sin error).
- Deshabilitar o marcar las estrategias no implementadas, y validarlo en `schema.ts`.

## F8. No hay edición de `parametros` de la regla ni de `valor_ordinal` de las opciones. Severidad: baja (media cuando exista una estrategia que los use)

**Evidencia:**
- `adapters.ts` crea siempre la regla `CLAVE_ITEM` con `parametersJson: "{}"`.
- `OptionList.tsx` no edita `ordinalValue`, aunque el tipo lo transporta.

**Impacto:** las estrategias específicas de un test leen su configuración de `regla_calificacion.parametros` (por ejemplo, el factor de corrección por azar o los ítems invertidos). Las de tipo Likert leen `opcion_item.valor_ordinal`. Sin UI, esos valores solo se cargan por API.

**A implementar:**
- Un editor JSON validado (objeto) por regla, idealmente con un formulario por estrategia a partir de un esquema que la estrategia publique.
- Campo numérico "valor ordinal" en cada opción.

## F9. La calificación se dispara a mano. Severidad: baja

**Evidencia:** `results/grading/GradingPage.tsx` llama a `POST /attempts/{id}/score`. Nada califica automáticamente al terminar el intento.

**Impacto:** hay intentos completados sin resultado hasta que alguien pulsa calificar. No compromete la creación del test, pero sí la operación diaria.

**A decidir (Orquestador):** calificar automáticamente al finalizar el intento (backend) o calificar en lote desde la UI. Queda fuera de esta rama.

## F10. Rúbricas sin soporte. Severidad: informativa

`rubrica_evaluacion`, `criterio_rubrica` y `nivel_criterio_rubrica` existen en el esquema, pero no hay endpoints, UI ni estrategia que las use. Para usarlas hace falta una estrategia `RUBRICA_MANUAL` y una UI de revisión por criterios.
