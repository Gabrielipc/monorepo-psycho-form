# Guía para agregar nuevos tests

Esta guía es para quienes incorporan un instrumento nuevo (un test psicológico, una batería o una forma alternativa) a UAM SIAT / PsychoForm. Explica cómo se representa un test, cómo se carga, cómo se publica y cómo se le agrega una regla de puntuación propia sin tocar la infraestructura.

> **Responsabilidad psicométrica.** La plataforma ejecuta las reglas de puntuación tal como se configuran. No garantiza que una clave, una fórmula o un baremo sean correctos para el instrumento. Quien agrega un test es responsable de validar su calificación contra el manual o la hoja de corrección oficial (ver la [sección 8](#8-validación-psicométrica-obligatoria)). Esto incluye las estrategias que ya existen: `CLAVE_SIMPLE` solo suma aciertos y no aplica corrección por azar, ítems invertidos ni transformaciones.

---

## 1. Alcance: qué se puede tocar y qué no

| Permitido | No permitido |
| :--- | :--- |
| Cargar el contenido del test como **datos**, por la UI o la API: versión, subtests, ítems, opciones, imágenes, reglas, claves, escalas, matriz y baremos. | Crear o modificar migraciones, tablas, tipos, triggers o `seed.sql` (`psycho-form/supabase/**`). |
| Agregar **una clase de estrategia** en `scoring/service/strategy` (o un subpaquete) con sus pruebas. | Cambiar controladores, seguridad, el flujo de sesiones o la fachada de calificación. |
| Leer parámetros propios del test desde `regla_calificacion.parametros` (JSON). | Agregar dependencias al `pom.xml` o al `package.json`. |
| Abrir un issue o PR con hallazgos sobre el núcleo, para que lo resuelva quien mantiene la arquitectura. | Hacer refactors fuera del alcance del test. |

Si el test necesita algo que el modelo no permite representar, no lo improvises: repórtalo (ver la [sección 10](#10-flujo-de-colaboración)).

---

## 2. Cómo se guarda un test

Un test no tiene código propio: es un árbol de registros que cuelga de una **versión**. Las tablas están en `psycho-form/supabase/migrations/20260621000100_create_bfa_schema.sql` y `20261122000200_integridad_dominio.sql`.

```text
test                              codigo_test único (p. ej. BFA, WEILL)
└── version_test                  numero_version, estado, estrategia_calificacion_id ◄── decide la estrategia
    ├── subtest                   codigo, numero_orden, tiempo_limite, aleatorización
    │   └── item                  codigo, tipo_item, tipo_respuesta, enunciado, puntaje_base
    │       ├── imagen_item ─────► recurso_multimedia (archivo en S3)
    │       └── opcion_item       codigo, texto, numero_orden, valor_ordinal
    │           └── imagen_opcion ► recurso_multimedia
    ├── dimension_resultado       escala de resultado (opcionalmente ligada a un subtest)
    ├── regla_calificacion        tipo_regla, alcance (versión/subtest/ítem), prioridad, estado, parametros JSONB
    │   ├── clave_respuesta       UNA por ítem: opción correcta | texto | número ± tolerancia | revisión manual
    │   │   └── clave_respuesta_opcion   conjunto exacto de opciones correctas (OPCION_MULTIPLE)
    │   └── opcion_puntaje_dimension     opción → escala, puntaje × peso
    ├── baremo                    de una escala, o total si dimension_resultado_id es NULL
    │   │                         criterios: edad mín/máx, sexo, carrera, vigencia
    │   └── rango_baremo          [mín, máx] → percentil, categoría, interpretación (sin solapes)
    └── rubrica_evaluacion …      existe en el esquema; hoy no la usa ninguna estrategia
```

Al aplicar el test se generan `sesion_aplicacion` → `asignacion_test` (con la edad, el sexo y la carrera del participante **al momento de aplicar**) → `intento_test` → `respuesta_item` (+ `opcion_seleccionada_respuesta`).

Al calificar se generan:

| Tabla | Contenido |
| :--- | :--- |
| `resultado` | Uno por intento: total directo y conteos. |
| `calificacion_respuesta` | Uno por respuesta calificada. |
| `resultado_dimension` | Uno por escala: puntaje directo, puntaje transformado, baremo, rango, percentil y categoría. |
| `revision_manual_respuesta` | Una por respuesta que requiere revisión humana. |

### 2.1 Tipos de ítem y de respuesta

- `tipo_item` describe la presentación: `SOLO_TEXTO`, `SOLO_IMAGEN`, `TEXTO_E_IMAGEN`, `COMPARACION_IMAGENES`, `RAZONAMIENTO_VERBAL`.
- `tipo_respuesta` define cómo se responde y cómo se corrige:

| `tipo_respuesta` | Cómo responde el participante | Clave que necesita (`CLAVE_SIMPLE`) |
| :--- | :--- | :--- |
| `OPCION_UNICA` | Elige una opción. | `opcion_correcta_id` |
| `VERDADERO_FALSO` | Elige una de dos opciones. | `opcion_correcta_id` |
| `OPCION_MULTIPLE` | Marca varias opciones. | Conjunto exacto: `texto_esperado` con códigos separados por coma (`"A,C"`) o filas de `clave_respuesta_opcion`. Es todo o nada. |
| `NUMERICA` | Escribe un número. | `valor_numerico_esperado` (+ `tolerancia_numerica`, 0 si es nula) |
| `TEXTO_ABIERTO` | Escribe texto. | `texto_esperado` (se compara sin acentos, sin distinguir mayúsculas y con espacios colapsados) o `requiere_revision_manual = true` |

Cualquier ítem puede marcarse con `requiere_revision_manual`. En ese caso no se autocalifica: queda en 0 y pendiente hasta que un revisor asigne el puntaje.

### 2.2 Reglas que hace cumplir la base de datos

- **Inmutabilidad.** Los triggers `tg_*_contenido_oficial` rechazan altas, bajas y cambios en el contenido de una versión `PUBLICADO` o `RETIRADO`. Para corregir un test publicado, se **clona** la versión (`POST /test-versions/{id}/clone`) y se publica la copia.
- **Unicidad.** Los códigos de subtest, ítem, opción, escala y baremo son únicos dentro de su padre, y lo mismo vale para los órdenes.
- **Alcance.** Una clave, una fila de matriz o una calificación tiene que pertenecer a la misma versión que su regla, ítem y escala. Los rangos de un baremo no pueden solaparse.
- **Una sola clave oficial por ítem** en toda la versión. Si hay dos, se rechaza la publicación.

---

## 3. Ciclo de vida de una versión

```text
BORRADOR ──approve──► APROBADO ──publish──► PUBLICADO ──(retiro)──► RETIRADO
   ▲  editable  ◄─return-to-draft─┘ no editable     inmutable; se puede aplicar en sesiones
   └──── clone ◄──────────────────────────────────┘
```

Al aprobar (`POST /test-versions/{id}/approve`), el backend valida antes de cambiar de estado:
- exige una estrategia **con implementación** y al menos una regla activa;
- ejecuta `validateConfiguration` sobre la configuración que se publicaría: reglas activas que no estén `RETIRADO`, con sus claves y su matriz.

Si hay problemas, responde 409 `La version no se puede aprobar: …` y la versión sigue en `BORRADOR`, editable. Para corregir una versión ya aprobada, devuélvela a borrador con `POST /test-versions/{id}/return-to-draft` (permiso `TEST_PUBLICAR`; solo desde `APROBADO`).

Al publicar (`POST /test-versions/{id}/publish`), el backend hace esto en una sola transacción:
1. Exige que la versión esté `APROBADO` y tenga estrategia.
2. Promueve a `PUBLICADO` las reglas y baremos activos. Las reglas inactivas conservan su estado y no participan en la calificación.
3. Comprueba que la estrategia de la versión **tenga implementación**. Si no la tiene, responde 409.
4. Carga la configuración y ejecuta `validateConfiguration` de la estrategia. Si hay problemas, responde 409 con el mensaje `La version no se puede publicar: problema 1; problema 2` y no publica nada.
5. Marca la versión como `PUBLICADO`.

---

## 4. Cargar un test

### 4.1 Desde la interfaz (recomendado)

El builder de instrumentos (`/app/instrumentos`) cubre versión, subtests, ítems, opciones, imágenes de enunciado y de opciones, claves de respuesta, baremos y rangos. Crea automáticamente una regla `CLAVE_ITEM` por subtest.

Algunas capacidades del backend todavía no tienen interfaz: escalas, matriz opción-dimensión, criterios normativos de baremos, parámetros de regla y valor ordinal. Están listadas en [`docs/hallazgos-frontend-creacion-tests.md`](hallazgos-frontend-creacion-tests.md). Mientras sigan abiertas, esas partes se cargan por la API (4.2).

> Hoy la UI marca por error las claves `NUMERICA`, `TEXTO_ABIERTO` y `OPCION_MULTIPLE` como "no soportadas" (hallazgo F1). El backend sí las califica. Hasta que se corrija, hay que publicar esas versiones por la API.

### 4.2 Por la API

Todas las rutas son de staff y requieren JWT con el permiso indicado. La documentación interactiva está en Swagger UI (`/swagger-ui.html` del backend). Todas las respuestas usan el sobre `{ success, data, error }`.

Orden recomendado (cada paso usa los ids del anterior):

| # | Paso | Endpoint | Permiso |
| :--- | :--- | :--- | :--- |
| 1 | Test | `POST /tests` `{code, name, description}` | `TEST_CREAR` |
| 2 | Versión | `POST /tests/{id}/versions` `{number, strategyId, instructions, timeLimitSeconds, randomizeSubtests, randomizeItems}` | `TEST_CREAR` |
| 3 | Subtests | `POST /test-versions/{id}/subtests` `{code, name, instructions, order, timeLimitSeconds, …}` | `TEST_CREAR` |
| 4 | Ítems | `POST /subtests/{id}/items` `{code, itemType, responseType, prompt, order, baseScore, …}` | `TEST_CREAR` |
| 5 | Opciones | `POST /items/{id}/options` `{code, text, order, ordinalValue}` | `TEST_CREAR` |
| 6 | Imágenes | `POST /items/{id}/images` y `POST /options/{id}/images` (multipart) | `TEST_CREAR` |
| 7 | Regla | `POST /subtests/{id}/scoring-rules` `{strategyId, ruleType, itemId?, priority, parametersJson, observation, active?}` | `CALIFICACION_CONFIGURAR` |
| 8 | Claves | `POST /items/{id}/answer-key` `{ruleId, correctOptionId, expectedText, expectedNumber, numericTolerance, score, requiresManualReview}` | `CALIFICACION_CONFIGURAR` |
| 9 | Escalas | `POST /test-versions/{id}/dimensions` `{code, name, subtestId?, order, minScore?, maxScore?}` | `CALIFICACION_CONFIGURAR` |
| 10 | Matriz (opcional) | `PUT /scoring-rules/{id}/option-scores` `{rows:[{optionId, dimensionId, score, weight?}]}` | `CALIFICACION_CONFIGURAR` |
| 11 | Baremos | `POST /baremos` `{versionId, dimensionId?, code, name, normativeGroup, minAge?, maxAge?, sexId?, careerId?, validFrom?, validTo?}` | `BAREMO_CONFIGURAR` |
| 12 | Rangos | `POST /baremos/{id}/ranges` `{minScore, maxScore, percentile, category, interpretation, order}` | `BAREMO_CONFIGURAR` |
| 13 | Aprobar | `POST /test-versions/{id}/approve` (valida la configuración; para corregir después: `POST /test-versions/{id}/return-to-draft`) | `TEST_PUBLICAR` |
| 14 | Publicar | `POST /test-versions/{id}/publish` | `TEST_PUBLICAR` |

Notas:
- `strategyId` es el id de `GET /scoring/strategies`. Usa solo estrategias con `implemented: true`.
- `parametersJson` tiene que ser un **objeto** JSON (`"{}"` si no hay parámetros). Cualquier otro valor da 400.
- `PATCH /scoring-rules/{id}` acepta `active`. Si se omite o es `null`, se conserva el valor actual.
- Los criterios de un baremo (`minAge`, `maxAge`, `sexId`, `careerId`, `validFrom`, `validTo`) se conservan en `PATCH /baremos/{id}` cuando vienen `null`. Para borrarlos, envía `clearNormativeCriteria: true`: se limpian los seis y luego se aplican los que vengan con valor.
- Para cargar muchos ítems de una vez existe `POST /test-versions/{id}/configuration`, que guarda el documento completo de subtests, ítems, opciones, imágenes y claves que usa el builder.
- Una escala sin `subtestId` solo recibe puntaje por la matriz. Una escala **con** `subtestId` recibe, con `CLAVE_SIMPLE`, la suma de los ítems de su subtest que no tienen matriz.
- El conjunto exacto `clave_respuesta_opcion` todavía no tiene endpoint propio. Para `OPCION_MULTIPLE` usa `expectedText` con códigos (`"A,C"`).

Un script de carga que encadene estas llamadas (por ejemplo, a partir de un CSV de ítems) es la forma reproducible de dar de alta un test grande. Guárdalo con los materiales del test, fuera de `supabase/`, y no lo conviertas en una migración.

---

## 5. Cómo se califica

```text
POST /attempts/{id}/score
  └─ ScoringService (fachada: permisos, bloqueo del intento, idempotencia)
       ├─ ScoringStrategyRegistry.require(version.estrategia)     ← elige la estrategia por código
       ├─ ScoringContextLoader.load(intento)                      ← snapshot inmutable: versión + intento
       ├─ strategy.score(contexto)  →  ScoringOutcome             ← cálculo puro, sin BD
       ├─ ScoringOutcomeValidator                                 ← rechaza outcomes inválidos
       └─ ScoringResultWriter + BaremoResolver                    ← escribe resultado, calificaciones, escalas y revisiones
```

- **Idempotente.** Si el intento ya tiene resultado, no se recalcula: solo se garantiza que existan las revisiones pendientes.
- **Revisión manual.** Al resolver una revisión (`PUT /manual-review/{id}`) o al marcar una respuesta para revisión, `ResultRecalculator` vuelve a ejecutar **la misma estrategia** con el contexto actualizado. Luego actualiza en sitio el resultado, las calificaciones y las escalas, conservando los ids.
- **Baremos.** `BaremoResolver` elige, para cada escala y para el total:
  1. Candidatos: baremos `APROBADO` o `PUBLICADO` de la escala (o totales).
  2. Un candidato aplica si **cada** criterio que define coincide con el perfil de la asignación (edad, sexo, carrera) y la fecha de aplicación está dentro de su vigencia. Si el baremo exige un dato que el participante no tiene, no aplica.
  3. Gana el más específico (más criterios definidos), luego el aprobado más recientemente y luego el de id mayor.
  4. El rango es el primero, por `orden`, que contiene el puntaje directo con extremos inclusivos. Si ninguno lo contiene, queda registrado el baremo y el rango queda vacío.
- **`puntaje_transformado`** solo se llena si la estrategia lo calcula (T, típica, eneatipo, etc.). Ya no se copia el percentil.

### 5.1 `CLAVE_SIMPLE`, la estrategia incluida

| Aspecto | Comportamiento |
| :--- | :--- |
| Ítems que califica | Cada respuesta de un ítem activo con clave oficial. Las respuestas de ítems sin clave se ignoran. |
| Puntaje por ítem | `clave_respuesta.puntaje` si es correcta, 0 si no lo es. Los ítems con revisión manual valen 0 mientras están pendientes y el puntaje asignado cuando se resuelven. |
| Total | Suma de los puntajes por ítem. |
| Escalas | Ítem con matriz: suma `puntaje × peso` de cada opción seleccionada. Ítem sin matriz o con revisión manual: su puntaje va a la escala ligada a su subtest (la primera por orden). Solo aparecen escalas que recibieron algún aporte. |
| Conteos | `cantidad_items` = respuestas calificadas; `correctas` / `incorrectas`; `pendientes_revision`. |
| Omisiones | Un ítem **sin fila de respuesta** no se califica ni cuenta como incorrecto. Si existe la fila pero está en blanco (por ejemplo, el participante visitó el ítem y no marcó nada), **sí** se califica y cuenta como incorrecta. Usa `AnswerSnapshot.isBlank()` en tu estrategia si el manual las trata distinto. |
| Validación al aprobar y publicar | Al menos un ítem activo; cada ítem activo con exactamente una clave; clave coherente con su tipo de respuesta (tabla 2.1); las opciones correctas de la clave (por id o por código) existen y están activas en el ítem. |

Si el test necesita algo distinto (corrección por azar, ítems invertidos, puntajes por opción, promedios, transformaciones, criterios de discontinuación), escribe una estrategia propia.

---

## 6. Agregar una estrategia de puntuación propia

### 6.1 Qué hay que hacer

1. Crea una clase `@Component` que implemente `com.uam.psychoform.scoring.service.strategy.ScoringStrategy`.
2. Elige un `code()` único, en mayúsculas y estable, por ejemplo `BFA_1992` o `CLAVE_CORRECCION_AZAR`. Ese código queda guardado en `estrategia_calificacion.codigo` y en las versiones que lo usan, así que **no lo cambies** una vez publicado.
3. Devuelve un `StrategyDescriptor` con nombre, descripción, `TipoEstrategiaCalificacion` (usa `FORMULA_CONTROLADA` para fórmulas propias), si puede dejar ítems para revisión manual y si admite baremos.
4. Implementa `score(ScoringContext)` y, casi siempre, `validateConfiguration(ScoringConfiguration)`.
5. Escribe las pruebas (sección 7).

**No hay que tocar nada más.** Al arrancar, el backend registra la estrategia en el catálogo `estrategia_calificacion` si su código no existe, sin modificar filas ya existentes. A partir de ahí aparece en `GET /scoring/strategies` con `implemented: true` y se puede asignar a una versión. El registro automático se desactiva con `psychoform.scoring.catalog-sync.enabled=false`. Si dos estrategias declaran el mismo código, la aplicación no arranca.

### 6.2 El contrato

```java
public interface ScoringStrategy {
    String code();                                              // estrategia_calificacion.codigo
    StrategyDescriptor descriptor();                            // fila de catálogo
    default List<String> validateConfiguration(ScoringConfiguration configuration) { return List.of(); }
    ScoringOutcome score(ScoringContext context);               // cálculo puro
}
```

**Entrada (`ScoringContext`):** son records inmutables sin entidades JPA, así que la estrategia **no puede** ni debe acceder a la base de datos.
- `configuration()`:
  - `subtests()`, `items()` (activos, en orden, con sus `options()` y `ordinalValue`), `rules()` (con `parameters()` como `JsonNode`), `keysByItem()`, `matrix()`, `dimensions()`.
  - Helpers: `item(id)`, `itemsOfSubtest(id)`, `dimensionOfSubtest(id)`, `rule(id)`, `rulesForItem(itemId)` (primero las de ítem, luego subtest y luego versión, por prioridad), `matrixForOption(id)`, `itemHasMatrix(id)`.
- `attempt()`: `profile()` (edad, sexo, carrera, fecha de aplicación), `startedAt()`, `finishedAt()`, `answersByItem()`.
- Helpers del contexto: `answer(itemId)`, `answeredItems()`, `unansweredItems()`.
- `AnswerSnapshot` trae: `selectedOptionIds`, `selectedOptionCodes`, `textAnswer`, `numericAnswer`, `timeUsedSeconds`, `flaggedForManualReview`, `review()` (estado y puntaje asignado), `isBlank()`.

**Salida (`ScoringOutcome`):**
- `totalDirectScore`: el total del test, según tu fórmula.
- `items`: una `ItemScore` por respuesta calificada. Es obligatoria para toda respuesta que quieras mostrar en el detalle o mandar a revisión manual. `pendingManualReview = true` crea la revisión pendiente.
- `dimensions`: una `DimensionScore` por escala, con `directScore` y opcionalmente `transformedScore`.

**Validaciones de la fachada.** Si el outcome no las cumple, la calificación falla con 409, porque indica un error en la estrategia:
- cada `answerId` pertenece al intento y no se repite;
- cada `dimensionId`, `ruleId` y `optionId` pertenece a la configuración;
- ningún puntaje es nulo.

Los puntajes se guardan con 2 decimales. Antes de persistir y de resolver el baremo, la fachada redondea total, ítems, escalas y transformados con `HALF_UP`, así que el baremo se aplica sobre el mismo valor que se guarda. Si el manual define otro redondeo, aplícalo en la estrategia.

**Piezas reutilizables:**
- `KeyedItemGrader.gradeAll(context)`: califica cada respuesta como `CLAVE_SIMPLE`, incluida la revisión manual. Devuelve `GradedItem(item, answer, key, score, manualReview)`.
- `DimensionAccumulator`: `addMatrix(answer)`, `addToSubtestDimension(item, score)`, `addKeyed(graded)` (regla de `CLAVE_SIMPLE`), `add(dimensionId, valor)` y `build()`.
- `ClaveCorrectnessEvaluator`: corrección por tipo de respuesta.

### 6.3 Parámetros del test

Lo que distingue a un test de otro (penalizaciones, ítems invertidos, puntos de corte, pesos) va en `regla_calificacion.parametros`, no en el código. Por ejemplo, en la regla de cada subtest:

```json
{ "penalizacion_por_error": 0.25 }
```

En la estrategia se lee con `rule.parameters().path("penalizacion_por_error")`. Valida en `validateConfiguration` que cada parámetro obligatorio exista y tenga el tipo esperado. Así, un error de configuración bloquea la publicación en lugar de producir resultados incorrectos.

### 6.4 Ejemplo completo: clave con corrección por azar

Ejemplo **ilustrativo**. Verifica la fórmula contra el manual de tu instrumento antes de usarla. Por subtest, el puntaje es `aciertos − errores × p`, donde `p` viene de la regla del subtest y las omisiones no penalizan.

```java
package com.uam.psychoform.scoring.service.strategy;

import com.uam.psychoform.instrument.model.TipoEstrategiaCalificacion;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.stereotype.Component;

/** Clave simple con corrección por azar por subtest: aciertos - errores x penalizacion_por_error. */
@Component
public class CorreccionAzarScoringStrategy implements ScoringStrategy {
    public static final String CODE = "CLAVE_CORRECCION_AZAR";
    static final String PENALTY = "penalizacion_por_error";
    private static final StrategyDescriptor DESCRIPTOR = new StrategyDescriptor(CODE,
            "Clave con corrección por azar",
            "Por subtest: aciertos menos una fracción de los errores. Las omisiones no penalizan.",
            TipoEstrategiaCalificacion.FORMULA_CONTROLADA, false, true);

    private final ClaveSimpleScoringStrategy claveSimple = new ClaveSimpleScoringStrategy();

    @Override
    public String code() {
        return CODE;
    }

    @Override
    public StrategyDescriptor descriptor() {
        return DESCRIPTOR;
    }

    @Override
    public List<String> validateConfiguration(ScoringConfiguration configuration) {
        // Mismas exigencias de claves que CLAVE_SIMPLE, más el parámetro de cada subtest.
        List<String> problems = new ArrayList<>(claveSimple.validateConfiguration(configuration));
        for (ScoringConfiguration.SubtestInfo subtest : configuration.subtests()) {
            if (subtest.active() && penalty(configuration, subtest.id()).isEmpty()) {
                problems.add("Subtest " + subtest.code() + ": la regla del subtest debe definir "
                        + PENALTY + " numerico en parametros");
            }
        }
        return problems;
    }

    @Override
    public ScoringOutcome score(ScoringContext context) {
        ScoringConfiguration configuration = context.configuration();
        List<KeyedItemGrader.GradedItem> graded = KeyedItemGrader.gradeAll(context);
        DimensionAccumulator dimensions = new DimensionAccumulator(configuration);
        BigDecimal total = BigDecimal.ZERO;

        for (ScoringConfiguration.SubtestInfo subtest : configuration.subtests()) {
            BigDecimal p = penalty(configuration, subtest.id()).orElse(BigDecimal.ZERO);
            BigDecimal hits = BigDecimal.ZERO;
            int errors = 0;
            for (KeyedItemGrader.GradedItem item : graded) {
                if (item.item().subtestId() != subtest.id()) {
                    continue;
                }
                if (Boolean.TRUE.equals(item.score().correct())) {
                    hits = hits.add(item.score().score());
                } else if (!item.manualReview() && !item.answer().isBlank()) {
                    errors++;  // respondida e incorrecta; las omisiones no cuentan
                }
            }
            BigDecimal raw = hits.subtract(p.multiply(BigDecimal.valueOf(errors)))
                    .setScale(2, RoundingMode.HALF_UP);
            configuration.dimensionOfSubtest(subtest.id()).ifPresent(d -> dimensions.add(d.id(), raw));
            total = total.add(raw);
        }

        List<ItemScore> items = graded.stream().map(KeyedItemGrader.GradedItem::score).toList();
        return new ScoringOutcome(total, items, dimensions.build());
    }

    /** Penalización de la regla de alcance subtest (sin ítem), la de menor prioridad si hay varias. */
    private static Optional<BigDecimal> penalty(ScoringConfiguration configuration, long subtestId) {
        return configuration.rules().stream()
                .filter(rule -> rule.itemId() == null && Objects.equals(rule.subtestId(), subtestId))
                .sorted(java.util.Comparator.comparingInt(ScoringConfiguration.RuleInfo::priority))
                .map(rule -> rule.parameters().path(PENALTY))
                .filter(JsonNode::isNumber)
                .map(JsonNode::decimalValue)
                .findFirst();
    }
}
```

Para usarla:
1. Arranca el backend: la estrategia aparece en `GET /scoring/strategies`.
2. Crea una versión con ese `strategyId`.
3. En la regla de cada subtest, guarda `parametersJson: "{\"penalizacion_por_error\": 0.25}"`.
4. Carga claves y escalas.
5. Aprueba y publica.

Si falta el parámetro en algún subtest, la publicación responde 409 con el subtest exacto.

---

## 7. Pruebas obligatorias

Toda estrategia nueva entra con pruebas unitarias **puras** (JUnit, sin Spring, sin Mockito, sin BD). El builder de test `ScoringContextBuilder` (`src/test/java/com/uam/psychoform/scoring/service/strategy/`) arma contextos en pocas líneas:

```java
class CorreccionAzarScoringStrategyTest {
    private final CorreccionAzarScoringStrategy strategy = new CorreccionAzarScoringStrategy();

    @Test
    void aciertosMenosErroresPorPenalizacionYOmisionesNoPenalizan() {
        ScoringContext context = ScoringContextBuilder.forVersion(1L, CorreccionAzarScoringStrategy.CODE)
                .subtest(5L, "VER")
                .rule(1L, 5L, null, TipoReglaCalificacion.CLAVE_ITEM, 1, "{\"penalizacion_por_error\": 0.25}")
                .dimension(60L, "VER", 5L, 1)
                .item(10L, 5L, "V-01", TipoRespuesta.OPCION_UNICA).option(10L, 101L, "A").option(10L, 102L, "B")
                .item(11L, 5L, "V-02", TipoRespuesta.OPCION_UNICA).option(11L, 111L, "A").option(11L, 112L, "B")
                .item(12L, 5L, "V-03", TipoRespuesta.OPCION_UNICA).option(12L, 121L, "A").option(12L, 122L, "B")
                .keyForOption(10L, 101L, "1").keyForOption(11L, 111L, "1").keyForOption(12L, 121L, "1")
                .answerOptions(10L, 900L, 101L)   // acierto
                .answerOptions(11L, 901L, 112L)   // error
                .context();                        // V-03 omitido

        ScoringOutcome outcome = strategy.score(context);

        assertThat(outcome.totalDirectScore()).isEqualByComparingTo("0.75");   // 1 - 1 x 0.25
        assertThat(outcome.dimensions()).singleElement()
                .satisfies(d -> assertThat(d.directScore()).isEqualByComparingTo("0.75"));
    }
}
```

**Escenarios mínimos que debe cubrir cada estrategia:**
- un caso resuelto a mano del manual o la hoja de corrección oficial por cada fórmula (sección 8);
- respuestas correctas, incorrectas, omitidas y en blanco;
- ítems con revisión manual pendiente y resuelta, si la estrategia lo permite;
- los bordes de cada parámetro (0, máximo, valores negativos si la fórmula los admite);
- `validateConfiguration`: falta de clave, falta de parámetro, parámetro con tipo incorrecto.

**Antes del PR** ejecuta en `psycho-form/psychoform` la suite completa:

```sh
./mvnw test
```

Las pruebas de integración necesitan Supabase local (`./dev.sh up` o `supabase start` en `psycho-form/`). Hay un fallo conocido de `ApiResponseWebTest` en la suite completa por agotamiento de conexiones: esa prueba pasa cuando se ejecuta sola y su fallo no es motivo de rechazo. Cualquier otro fallo sí lo es.

---

## 8. Validación psicométrica obligatoria

Las estrategias existentes no fueron validadas contra ningún manual. La validación es responsabilidad de quien agrega el test. Este checklist va completo en la descripción del PR:

- [ ] **Fuente.** Manual, edición, tabla y página de donde salen la clave, la fórmula y los baremos.
- [ ] **Clave.** Todas las claves cotejadas ítem por ítem contra la hoja oficial, por dos personas.
- [ ] **Casos resueltos a mano.** Al menos 3 protocolos ficticios (alto, medio y bajo) calificados a mano y por el sistema, con resultados idénticos.
- [ ] **Omisiones y respuestas en blanco.** Están tratadas como dice el manual. `CLAVE_SIMPLE` no las cuenta como error.
- [ ] **Corrección por azar, ítems invertidos y discontinuación.** Si el manual los define, la estrategia los aplica. `CLAVE_SIMPLE` no aplica ninguno.
- [ ] **Escalas.** Cada escala del manual existe como `dimension_resultado` y recibe exactamente los ítems que le corresponden.
- [ ] **Baremos.**
  - [ ] Hay un baremo por grupo normativo, con los criterios de edad, sexo y carrera exactos del manual.
  - [ ] Los rangos cubren todo el recorrido posible, sin huecos para puntajes decimales. Si la fórmula produce decimales, los rangos deben contemplarlos (por ejemplo `[18, 18.99]`).
  - [ ] Las inversiones o duplicados de la tabla original están documentados.
- [ ] **Puntaje transformado.** Si el manual define T, típica o eneatipo, la estrategia lo calcula. Si no lo define, queda vacío.
- [ ] **Perfil del participante.** La edad usada es la registrada en la asignación al aplicar el test. Si el manual usa edad en años y meses, documenta la diferencia.

---

## 9. Errores frecuentes

| Síntoma | Causa | Qué hacer |
| :--- | :--- | :--- |
| `409 La estrategia X no tiene implementacion registrada` | La versión usa una estrategia del catálogo sin clase (por ejemplo `LIKERT_ESCALA`). | Usa una estrategia con `implemented: true` o implementa la que falta. |
| `409 La version no se puede aprobar: Subtest FI: el item FI-03 no tiene clave de respuesta` (o `… publicar: …`) | Falta una clave, es incoherente con el tipo de respuesta o apunta a opciones inexistentes o inactivas. | Completa la clave o marca el ítem para revisión manual. Si la versión ya está aprobada, usa `return-to-draft`. |
| `409 El item X tiene mas de una clave de respuesta oficial` | Dos reglas activas tienen clave para el mismo ítem. | Desactiva la regla sobrante con `PATCH /scoring-rules/{id}` `{…, active: false}`. |
| `409 Contenido oficial inmutable` | Se intentó editar una versión publicada. | Clona la versión y edita la copia. |
| `400 parametros debe ser un objeto JSON valido` | `parametersJson` no es un objeto JSON. | Envía `{}` o un objeto válido. |
| El resultado no tiene escalas | No hay `dimension_resultado`, o la escala no está ligada al subtest y no hay matriz. | Crea las escalas (`POST /test-versions/{id}/dimensions`) con `subtestId`. |
| La escala no tiene categoría ni percentil | Ningún baremo aplica al perfil, o el puntaje cae fuera de todos los rangos. | Revisa los criterios del baremo frente al perfil y la cobertura de los rangos. |
| La calificación falla con un error de la estrategia | El outcome referencia respuestas, escalas u opciones ajenas, o tiene puntajes nulos. | Corrige la estrategia y agrega una prueba que lo reproduzca. |

---

## 10. Flujo de colaboración

1. **Rama.** Créala desde `main` con el nombre `feat/test-<codigo>` (por ejemplo `feat/test-weill`).
2. **Contenido.** Carga el test en un entorno local por la UI o con un script de API. No agregues SQL a `supabase/`.
3. **Estrategia (si aplica).** Crea una clase y su prueba en `scoring/service/strategy`, sin cambios en otros archivos de producción. Si necesitas cambiar el núcleo (la fachada, el loader, los snapshots o la persistencia), **detente** y abre un issue que explique el caso. Esos cambios los decide quien mantiene la arquitectura (ver `AGENTS.md`).
4. **PR.** Incluye:
   - descripción del instrumento y su fuente;
   - el checklist de la sección 8 completo;
   - los casos resueltos a mano;
   - el resultado de `./mvnw test`.
5. **Revisión.** El PR pasa por revisión independiente. La revisión rechaza la estrategia si no hay casos resueltos a mano, si tiene acceso a datos fuera del contexto, o si modifica archivos fuera de su alcance.
6. **Publicación.** La versión se publica en producción solo después del merge, con el mismo contenido validado localmente.

---

## Referencia rápida de archivos

| Qué | Dónde |
| :--- | :--- |
| Contrato y snapshots | `psycho-form/psychoform/src/main/java/com/uam/psychoform/scoring/service/strategy/` |
| Estrategia incluida | `…/scoring/service/strategy/ClaveSimpleScoringStrategy.java` |
| Utilidades reutilizables | `KeyedItemGrader`, `DimensionAccumulator`, `…/scoring/service/ClaveCorrectnessEvaluator.java` |
| Fachada y persistencia | `…/scoring/service/{ScoringService,ScoringResultWriter,ResultRecalculator,ScoringContextLoader}.java` |
| Elección de baremos | `…/scoring/service/BaremoResolver.java` |
| Registro y catálogo | `…/scoring/service/{ScoringStrategyRegistry,ScoringStrategyCatalogSynchronizer}.java` |
| Validación al publicar | `…/instrument/service/VersionTestService.java` |
| Builder de pruebas | `psycho-form/psychoform/src/test/java/com/uam/psychoform/scoring/service/strategy/ScoringContextBuilder.java` |
| Esquema de BD | `psycho-form/supabase/migrations/` (solo lectura para quien agrega tests) |
| Brechas de la UI | `docs/hallazgos-frontend-creacion-tests.md` |
