package com.uam.psychoform.scoring.service.strategy;

import java.util.List;
import java.util.Optional;

/** Entrada de una estrategia: configuracion de la version mas el intento a calificar. */
public record ScoringContext(ScoringConfiguration configuration, AttemptSnapshot attempt) {

    /** Respuesta al item, si existe. */
    public Optional<AnswerSnapshot> answer(long itemId) {
        return Optional.ofNullable(attempt.answersByItem().get(itemId));
    }

    /** Items de la configuracion con respuesta no vacia. */
    public List<ScoringConfiguration.ItemInfo> answeredItems() {
        return configuration.items().stream()
                .filter(item -> answer(item.id()).filter(answer -> !answer.isBlank()).isPresent())
                .toList();
    }

    /** Items de la configuracion sin respuesta o con respuesta vacia. */
    public List<ScoringConfiguration.ItemInfo> unansweredItems() {
        return configuration.items().stream()
                .filter(item -> answer(item.id()).filter(answer -> !answer.isBlank()).isEmpty())
                .toList();
    }
}
