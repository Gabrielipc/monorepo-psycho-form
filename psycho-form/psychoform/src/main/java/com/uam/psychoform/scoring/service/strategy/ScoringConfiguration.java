package com.uam.psychoform.scoring.service.strategy;

import com.fasterxml.jackson.databind.JsonNode;
import com.uam.psychoform.instrument.model.TipoItem;
import com.uam.psychoform.instrument.model.TipoReglaCalificacion;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Todo lo que la calificacion necesita de la version y que no depende del intento: subtests, items activos con sus
 * opciones, reglas oficiales, claves, matriz opcion-dimension y dimensiones. Es un snapshot inmutable de datos planos,
 * sin entidades JPA, para poder probar estrategias con JUnit puro.
 *
 * @param strategyCode codigo de la estrategia de la version
 * @param items items ACTIVO de subtests ACTIVO, en orden de subtest e item
 * @param rules reglas activas en estado APROBADO o PUBLICADO
 * @param keysByItem clave oficial de cada item que la tiene
 * @param matrix filas activas de la matriz opcion-dimension cuya regla es activa y oficial
 * @param dimensions dimensiones activas en orden de presentacion
 */
public record ScoringConfiguration(long versionId, String strategyCode, List<SubtestInfo> subtests,
        List<ItemInfo> items, List<RuleInfo> rules, Map<Long, AnswerKey> keysByItem, List<MatrixRow> matrix,
        List<DimensionInfo> dimensions) {

    public ScoringConfiguration {
        subtests = copy(subtests);
        items = copy(items);
        rules = copy(rules);
        keysByItem = keysByItem == null ? Map.of() : Map.copyOf(keysByItem);
        matrix = copy(matrix);
        dimensions = copy(dimensions);
    }

    private static <T> List<T> copy(List<T> list) {
        return list == null ? List.of() : List.copyOf(list);
    }

    /** Subtest de la version; {@code strategyCode} es la estrategia propia del subtest (puede ser null). */
    public record SubtestInfo(long id, String code, String name, int order, String strategyCode, boolean active) {
    }

    public record OptionInfo(long id, String code, int order, BigDecimal ordinalValue, boolean active) {
    }

    public record ItemInfo(long id, long subtestId, String code, TipoItem itemType, TipoRespuesta answerType,
            BigDecimal baseScore, int order, boolean required, List<OptionInfo> options) {
        public ItemInfo {
            options = options == null ? List.of() : List.copyOf(options);
        }
    }

    /** Regla de calificacion; {@code parameters} es el JSON de {@code parametros} ({@code {}} si no tiene). */
    public record RuleInfo(long id, Long subtestId, Long itemId, TipoReglaCalificacion ruleType, int priority,
            JsonNode parameters) {
    }

    public record MatrixRow(long optionId, long dimensionId, long ruleId, BigDecimal score, BigDecimal weight) {
    }

    public record DimensionInfo(long id, String code, String name, Long subtestId, int order, BigDecimal min,
            BigDecimal max) {
    }

    /** Item activo de la configuracion. */
    public Optional<ItemInfo> item(long itemId) {
        return items.stream().filter(item -> item.id() == itemId).findFirst();
    }

    /** Items activos del subtest, en orden. */
    public List<ItemInfo> itemsOfSubtest(long subtestId) {
        return items.stream().filter(item -> item.subtestId() == subtestId).toList();
    }

    /** Dimension (la primera por orden de presentacion) vinculada al subtest. */
    public Optional<DimensionInfo> dimensionOfSubtest(long subtestId) {
        return dimensions.stream()
                .filter(dimension -> dimension.subtestId() != null && dimension.subtestId() == subtestId)
                .min(Comparator.comparingInt(DimensionInfo::order));
    }

    public Optional<RuleInfo> rule(long ruleId) {
        return rules.stream().filter(rule -> rule.id() == ruleId).findFirst();
    }

    /**
     * Reglas que cubren el item: primero las de alcance item, luego las de subtest y al final las de version; dentro
     * de cada alcance, por prioridad.
     */
    public List<RuleInfo> rulesForItem(long itemId) {
        Long subtestId = item(itemId).map(ItemInfo::subtestId).orElse(null);
        Comparator<RuleInfo> byPriority = Comparator.comparingInt(RuleInfo::priority);
        Stream<RuleInfo> ofItem = rules.stream().filter(rule -> rule.itemId() != null && rule.itemId() == itemId);
        Stream<RuleInfo> ofSubtest = rules.stream().filter(rule -> rule.itemId() == null && rule.subtestId() != null
                && subtestId != null && rule.subtestId().equals(subtestId));
        Stream<RuleInfo> ofVersion = rules.stream().filter(rule -> rule.itemId() == null && rule.subtestId() == null);
        return Stream.of(ofItem.sorted(byPriority), ofSubtest.sorted(byPriority), ofVersion.sorted(byPriority))
                .flatMap(stream -> stream)
                .collect(Collectors.toList());
    }

    /** Filas de la matriz de una opcion. */
    public List<MatrixRow> matrixForOption(long optionId) {
        return matrix.stream().filter(row -> row.optionId() == optionId).toList();
    }

    /** Si alguna opcion del item tiene filas en la matriz opcion-dimension. */
    public boolean itemHasMatrix(long itemId) {
        Set<Long> optionIds = item(itemId).map(item -> item.options().stream().map(OptionInfo::id)
                .collect(Collectors.toSet())).orElse(Set.of());
        return matrix.stream().anyMatch(row -> optionIds.contains(row.optionId()));
    }
}
