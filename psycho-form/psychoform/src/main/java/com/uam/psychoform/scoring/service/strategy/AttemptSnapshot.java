package com.uam.psychoform.scoring.service.strategy;

import java.time.LocalDateTime;
import java.util.Map;

/** Intento a calificar: perfil normativo y respuestas por item (en el orden en que se cargaron). */
public record AttemptSnapshot(long attemptId, LocalDateTime startedAt, LocalDateTime finishedAt,
        NormativeProfile profile, Map<Long, AnswerSnapshot> answersByItem) {
    public AttemptSnapshot {
        answersByItem = answersByItem == null ? Map.of() : java.util.Collections.unmodifiableMap(
                new java.util.LinkedHashMap<>(answersByItem));
    }
}
