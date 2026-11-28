package com.uam.psychoform.scoring.service.strategy;

import java.math.BigDecimal;
import java.util.List;

/**
 * Respuesta del participante a un item. {@code selectedOptionIds} y {@code selectedOptionCodes} comparten orden estable.
 *
 * @param review revision manual guardada o null
 */
public record AnswerSnapshot(long answerId, long itemId, List<Long> selectedOptionIds,
        List<String> selectedOptionCodes, String textAnswer, BigDecimal numericAnswer, Integer timeUsedSeconds,
        boolean flaggedForManualReview, ManualReviewSnapshot review) {
    public AnswerSnapshot {
        selectedOptionIds = selectedOptionIds == null ? List.of() : List.copyOf(selectedOptionIds);
        selectedOptionCodes = selectedOptionCodes == null ? List.of() : List.copyOf(selectedOptionCodes);
    }

    /** Sin opciones, con texto en blanco y sin numero. */
    public boolean isBlank() {
        return selectedOptionIds.isEmpty() && (textAnswer == null || textAnswer.isBlank()) && numericAnswer == null;
    }
}
