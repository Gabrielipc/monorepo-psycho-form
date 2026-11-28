package com.uam.psychoform.scoring.service.strategy;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.instrument.model.TipoItem;
import com.uam.psychoform.instrument.model.TipoReglaCalificacion;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import com.uam.psychoform.scoring.model.EstadoRevisionManual;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Constructor de {@link ScoringConfiguration} y {@link ScoringContext} para probar estrategias con JUnit puro (sin
 * Mockito ni base de datos). Se arma con ids explicitos para que las pruebas se lean sin ruido:
 *
 * <pre>
 * ScoringContext context = ScoringContextBuilder.forVersion(100L, "MI_ESTRATEGIA")
 *         .subtest(5L, "FI")
 *         .item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA)
 *         .option(10L, 1L, "A").option(10L, 2L, "B")
 *         .keyForOption(10L, 1L, "2.00")
 *         .answerOptions(10L, 500L, 1L)
 *         .context();
 * </pre>
 *
 * Todas las claves usan la regla {@link #DEFAULT_RULE_ID}, que el builder agrega a la configuracion si no se define.
 */
public final class ScoringContextBuilder {
    public static final long DEFAULT_RULE_ID = 1L;
    private static final ObjectMapper JSON = new ObjectMapper();

    private final long versionId;
    private final String strategyCode;
    private final List<ScoringConfiguration.SubtestInfo> subtests = new ArrayList<>();
    private final Map<Long, ItemDraft> items = new LinkedHashMap<>();
    private final List<ScoringConfiguration.RuleInfo> rules = new ArrayList<>();
    private final Map<Long, AnswerKey> keys = new LinkedHashMap<>();
    private final List<ScoringConfiguration.MatrixRow> matrix = new ArrayList<>();
    private final List<ScoringConfiguration.DimensionInfo> dimensions = new ArrayList<>();
    private final Map<Long, AnswerSnapshot> answers = new LinkedHashMap<>();
    private long attemptId = 1L;
    private NormativeProfile profile = new NormativeProfile(null, null, null, LocalDate.of(2026, 6, 24));

    private static final class ItemDraft {
        final long id;
        final long subtestId;
        final String code;
        final TipoRespuesta type;
        final int order;
        final List<ScoringConfiguration.OptionInfo> options = new ArrayList<>();

        ItemDraft(long id, long subtestId, String code, TipoRespuesta type, int order) {
            this.id = id;
            this.subtestId = subtestId;
            this.code = code;
            this.type = type;
            this.order = order;
        }
    }

    private ScoringContextBuilder(long versionId, String strategyCode) {
        this.versionId = versionId;
        this.strategyCode = strategyCode;
    }

    public static ScoringContextBuilder forVersion(long versionId, String strategyCode) {
        return new ScoringContextBuilder(versionId, strategyCode);
    }

    public ScoringContextBuilder subtest(long id, String code) {
        subtests.add(new ScoringConfiguration.SubtestInfo(id, code, "Subtest " + code, subtests.size() + 1, null,
                true));
        return this;
    }

    public ScoringContextBuilder item(long id, long subtestId, String code, TipoRespuesta type) {
        int order = (int) items.values().stream().filter(item -> item.subtestId == subtestId).count() + 1;
        items.put(id, new ItemDraft(id, subtestId, code, type, order));
        return this;
    }

    public ScoringContextBuilder option(long itemId, long optionId, String code) {
        ItemDraft item = items.get(itemId);
        item.options.add(new ScoringConfiguration.OptionInfo(optionId, code, item.options.size() + 1, null, true));
        return this;
    }

    public ScoringContextBuilder rule(long id, Long subtestId, Long itemId, TipoReglaCalificacion type, int priority,
            String parametersJson) {
        rules.add(new ScoringConfiguration.RuleInfo(id, subtestId, itemId, type, priority, parse(parametersJson)));
        return this;
    }

    public ScoringContextBuilder dimension(long id, String code, Long subtestId, int order) {
        dimensions.add(new ScoringConfiguration.DimensionInfo(id, code, "Dimension " + code, subtestId, order, null,
                null));
        return this;
    }

    public ScoringContextBuilder matrix(long optionId, long dimensionId, String score, String weight) {
        matrix.add(new ScoringConfiguration.MatrixRow(optionId, dimensionId, DEFAULT_RULE_ID, new BigDecimal(score),
                new BigDecimal(weight)));
        return this;
    }

    // ---- claves ----

    public ScoringContextBuilder key(AnswerKey key) {
        keys.put(key.itemId(), key);
        return this;
    }

    public ScoringContextBuilder keyForOption(long itemId, long correctOptionId, String score) {
        return key(answerKey(itemId, correctOptionId, null, null, null, score, false, Set.of()));
    }

    public ScoringContextBuilder keyNumeric(long itemId, String expected, String tolerance, String score) {
        return key(answerKey(itemId, null, null, new BigDecimal(expected),
                tolerance == null ? null : new BigDecimal(tolerance), score, false, Set.of()));
    }

    public ScoringContextBuilder keyText(long itemId, String expectedText, String score) {
        return key(answerKey(itemId, null, expectedText, null, null, score, false, Set.of()));
    }

    /** OPCION_MULTIPLE por codigos separados por coma. */
    public ScoringContextBuilder keyCodes(long itemId, String expectedCodes, String score) {
        return keyText(itemId, expectedCodes, score);
    }

    /** OPCION_MULTIPLE por conjunto de ids de opcion (clave_respuesta_opcion). */
    public ScoringContextBuilder keyOptionSet(long itemId, String score, Long... optionIds) {
        return key(answerKey(itemId, null, null, null, null, score, false, Set.of(optionIds)));
    }

    public ScoringContextBuilder keyManual(long itemId, String score) {
        return key(answerKey(itemId, null, null, null, null, score, true, Set.of()));
    }

    private static AnswerKey answerKey(long itemId, Long correctOptionId, String expectedText, BigDecimal number,
            BigDecimal tolerance, String score, boolean manual, Set<Long> optionSet) {
        return new AnswerKey(1000L + itemId, DEFAULT_RULE_ID, itemId, correctOptionId, expectedText, number,
                tolerance, new BigDecimal(score), manual, optionSet);
    }

    // ---- intento ----

    public ScoringContextBuilder attemptId(long attemptId) {
        this.attemptId = attemptId;
        return this;
    }

    public ScoringContextBuilder profile(Integer age, Short sexId, Short careerId, LocalDate applicationDate) {
        this.profile = new NormativeProfile(age, sexId, careerId, applicationDate);
        return this;
    }

    public ScoringContextBuilder answerOptions(long itemId, long answerId, long... optionIds) {
        ItemDraft item = items.get(itemId);
        List<Long> ids = new ArrayList<>();
        List<String> codes = new ArrayList<>();
        for (long optionId : optionIds) {
            ids.add(optionId);
            codes.add(item.options.stream().filter(option -> option.id() == optionId).findFirst()
                    .map(ScoringConfiguration.OptionInfo::code).orElse(null));
        }
        answers.put(itemId, new AnswerSnapshot(answerId, itemId, ids, codes, null, null, null, false, null));
        return this;
    }

    public ScoringContextBuilder answerText(long itemId, long answerId, String text) {
        answers.put(itemId, new AnswerSnapshot(answerId, itemId, List.of(), List.of(), text, null, null, false, null));
        return this;
    }

    public ScoringContextBuilder answerNumber(long itemId, long answerId, String number) {
        answers.put(itemId, new AnswerSnapshot(answerId, itemId, List.of(), List.of(), null,
                number == null ? null : new BigDecimal(number), null, false, null));
        return this;
    }

    /** Marca la respuesta del item para revision manual (respuesta_item.requiere_revision_manual). */
    public ScoringContextBuilder flagForManualReview(long itemId) {
        AnswerSnapshot a = answers.get(itemId);
        answers.put(itemId, new AnswerSnapshot(a.answerId(), a.itemId(), a.selectedOptionIds(),
                a.selectedOptionCodes(), a.textAnswer(), a.numericAnswer(), a.timeUsedSeconds(), true, a.review()));
        return this;
    }

    /** Adjunta una revision guardada a la respuesta del item. */
    public ScoringContextBuilder review(long itemId, EstadoRevisionManual status, String assignedScore) {
        AnswerSnapshot a = answers.get(itemId);
        answers.put(itemId, new AnswerSnapshot(a.answerId(), a.itemId(), a.selectedOptionIds(),
                a.selectedOptionCodes(), a.textAnswer(), a.numericAnswer(), a.timeUsedSeconds(),
                a.flaggedForManualReview(), new ManualReviewSnapshot(9000L + a.answerId(), status,
                        assignedScore == null ? null : new BigDecimal(assignedScore))));
        return this;
    }

    // ---- resultado ----

    public ScoringConfiguration configuration() {
        List<ScoringConfiguration.ItemInfo> itemInfos = items.values().stream()
                .map(item -> new ScoringConfiguration.ItemInfo(item.id, item.subtestId, item.code,
                        TipoItem.SOLO_TEXTO, item.type, BigDecimal.ONE, item.order, true, item.options))
                .toList();
        List<ScoringConfiguration.RuleInfo> allRules = new ArrayList<>(rules);
        if (allRules.stream().noneMatch(rule -> rule.id() == DEFAULT_RULE_ID)) {
            allRules.add(new ScoringConfiguration.RuleInfo(DEFAULT_RULE_ID, null, null,
                    TipoReglaCalificacion.CLAVE_ITEM, 1, JSON.createObjectNode()));
        }
        return new ScoringConfiguration(versionId, strategyCode, subtests, itemInfos, allRules, keys, matrix,
                dimensions);
    }

    public ScoringContext context() {
        return new ScoringContext(configuration(),
                new AttemptSnapshot(attemptId, null, null, profile, answers));
    }

    private static JsonNode parse(String json) {
        try {
            return json == null ? JSON.createObjectNode() : JSON.readTree(json);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException(exception);
        }
    }
}
