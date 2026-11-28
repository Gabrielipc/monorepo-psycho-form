package com.uam.psychoform.scoring.service.strategy;

import com.uam.psychoform.instrument.model.TipoEstrategiaCalificacion;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/** Estrategia CLAVE_SIMPLE: compara cada respuesta con su clave oficial y suma el puntaje de la clave por acierto. */
@Component
public class ClaveSimpleScoringStrategy implements ScoringStrategy {
    public static final String CODE = "CLAVE_SIMPLE";

    private static final StrategyDescriptor DESCRIPTOR = new StrategyDescriptor(CODE, "Clave simple",
            "Compara la respuesta contra una clave aprobada y suma puntaje por acierto.",
            TipoEstrategiaCalificacion.CLAVE_SIMPLE, false, true);

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
        if (configuration.items().isEmpty()) {
            return List.of("La version no tiene items activos para calificar");
        }
        List<String> problems = new ArrayList<>();
        Map<Long, List<ScoringConfiguration.ItemInfo>> missingBySubtest = new LinkedHashMap<>();
        for (ScoringConfiguration.ItemInfo item : configuration.items()) {
            AnswerKey key = configuration.keysByItem().get(item.id());
            if (key == null) {
                missingBySubtest.computeIfAbsent(item.subtestId(), id -> new ArrayList<>()).add(item);
            } else {
                coherenceProblem(configuration, item, key).ifPresent(problems::add);
            }
        }
        List<String> missing = new ArrayList<>();
        missingBySubtest.forEach((subtestId, items) -> {
            String subtest = subtestLabel(configuration, subtestId);
            String codes = items.stream().map(ScoringConfiguration.ItemInfo::code).collect(Collectors.joining(", "));
            missing.add(items.size() == 1
                    ? "Subtest " + subtest + ": el item " + codes + " no tiene clave de respuesta"
                    : "Subtest " + subtest + ": los items " + codes + " no tienen clave de respuesta");
        });
        missing.addAll(problems);
        return missing;
    }

    private static Optional<String> coherenceProblem(ScoringConfiguration configuration,
            ScoringConfiguration.ItemInfo item, AnswerKey key) {
        if (key.requiresManualReview() || item.answerType() == null) {
            return Optional.empty();
        }
        String prefix = "Subtest " + subtestLabel(configuration, item.subtestId()) + ": el item " + item.code();
        TipoRespuesta type = item.answerType();
        return switch (type) {
            case NUMERICA -> key.expectedNumber() == null
                    ? Optional.of(prefix + " es NUMERICA y su clave no tiene valor numerico esperado")
                    : Optional.empty();
            case TEXTO_ABIERTO -> key.expectedText() == null || key.expectedText().isBlank()
                    ? Optional.of(prefix + " es TEXTO_ABIERTO y su clave no tiene texto esperado")
                    : Optional.empty();
            case OPCION_MULTIPLE -> key.optionSetIds().isEmpty()
                    && (key.expectedText() == null || key.expectedText().isBlank()) && key.correctOptionId() == null
                    ? Optional.of(prefix + " es OPCION_MULTIPLE y su clave no define las opciones correctas")
                    : Optional.empty();
            case OPCION_UNICA, VERDADERO_FALSO -> key.correctOptionId() == null
                    ? Optional.of(prefix + " es " + type + " y su clave no tiene opcion correcta")
                    : Optional.empty();
        };
    }

    private static String subtestLabel(ScoringConfiguration configuration, long subtestId) {
        return configuration.subtests().stream()
                .filter(subtest -> subtest.id() == subtestId)
                .map(ScoringConfiguration.SubtestInfo::code)
                .findFirst()
                .orElse(String.valueOf(subtestId));
    }

    @Override
    public ScoringOutcome score(ScoringContext context) {
        List<KeyedItemGrader.GradedItem> graded = KeyedItemGrader.gradeAll(context);
        DimensionAccumulator dimensions = new DimensionAccumulator(context.configuration());
        BigDecimal total = BigDecimal.ZERO;
        List<ItemScore> items = new ArrayList<>();
        for (KeyedItemGrader.GradedItem item : graded) {
            dimensions.addKeyed(item);
            items.add(item.score());
            total = total.add(item.score().score());
        }
        return new ScoringOutcome(total, items, dimensions.build());
    }
}
