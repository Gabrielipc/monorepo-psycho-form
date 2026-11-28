package com.uam.psychoform.scoring.service;

import com.uam.psychoform.scoring.service.strategy.AnswerSnapshot;
import com.uam.psychoform.scoring.service.strategy.DimensionScore;
import com.uam.psychoform.scoring.service.strategy.ItemScore;
import com.uam.psychoform.scoring.service.strategy.ScoringConfiguration;
import com.uam.psychoform.scoring.service.strategy.ScoringContext;
import com.uam.psychoform.scoring.service.strategy.ScoringOutcome;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Verifica que el resultado de una estrategia sea coherente con el contexto antes de persistirlo. Un resultado invalido
 * es un defecto de la estrategia, por eso se informa como {@link IllegalStateException}.
 */
final class ScoringOutcomeValidator {
    private ScoringOutcomeValidator() {
    }

    static void validate(ScoringOutcome outcome, ScoringContext context) {
        String strategy = context.configuration().strategyCode();
        if (outcome == null || outcome.totalDirectScore() == null) {
            throw invalid(strategy, "no devolvio el puntaje total");
        }
        ScoringConfiguration configuration = context.configuration();
        Set<Long> answerIds = context.attempt().answersByItem().values().stream()
                .map(AnswerSnapshot::answerId)
                .collect(Collectors.toSet());
        Set<Long> ruleIds = configuration.rules().stream().map(ScoringConfiguration.RuleInfo::id)
                .collect(Collectors.toSet());
        Set<Long> optionIds = configuration.items().stream()
                .flatMap(item -> item.options().stream())
                .map(ScoringConfiguration.OptionInfo::id)
                .collect(Collectors.toSet());
        Set<Long> dimensionIds = configuration.dimensions().stream().map(ScoringConfiguration.DimensionInfo::id)
                .collect(Collectors.toSet());

        Set<Long> seenAnswers = new HashSet<>();
        for (ItemScore item : outcome.items()) {
            if (item == null || item.score() == null) {
                throw invalid(strategy, "hay una calificacion de item sin puntaje");
            }
            if (!answerIds.contains(item.answerId())) {
                throw invalid(strategy, "la respuesta " + item.answerId() + " no pertenece al intento");
            }
            if (!seenAnswers.add(item.answerId())) {
                throw invalid(strategy, "la respuesta " + item.answerId() + " esta calificada mas de una vez");
            }
            if (item.ruleId() != null && !ruleIds.contains(item.ruleId())) {
                throw invalid(strategy, "la regla " + item.ruleId() + " no pertenece a la configuracion");
            }
            if (item.optionId() != null && !optionIds.contains(item.optionId())) {
                throw invalid(strategy, "la opcion " + item.optionId() + " no pertenece a la configuracion");
            }
            if (item.dimensionId() != null && !dimensionIds.contains(item.dimensionId())) {
                throw invalid(strategy, "la dimension " + item.dimensionId() + " no pertenece a la configuracion");
            }
        }
        Set<Long> seenDimensions = new HashSet<>();
        for (DimensionScore dimension : outcome.dimensions()) {
            if (dimension == null || dimension.directScore() == null) {
                throw invalid(strategy, "hay una dimension sin puntaje directo");
            }
            if (!dimensionIds.contains(dimension.dimensionId())) {
                throw invalid(strategy, "la dimension " + dimension.dimensionId()
                        + " no pertenece a la configuracion");
            }
            if (!seenDimensions.add(dimension.dimensionId())) {
                throw invalid(strategy, "la dimension " + dimension.dimensionId() + " esta repetida");
            }
        }
    }

    private static IllegalStateException invalid(String strategy, String detail) {
        return new IllegalStateException("La estrategia " + strategy + " devolvio un resultado invalido: " + detail);
    }
}
