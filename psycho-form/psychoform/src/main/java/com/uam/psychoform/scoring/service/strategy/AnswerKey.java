package com.uam.psychoform.scoring.service.strategy;

import java.math.BigDecimal;
import java.util.Set;

/** Clave de respuesta oficial de un item ({@code clave_respuesta}). */
public record AnswerKey(long id, long ruleId, long itemId, Long correctOptionId, String expectedText,
        BigDecimal expectedNumber, BigDecimal numericTolerance, BigDecimal score, boolean requiresManualReview,
        Set<Long> optionSetIds) {
    public AnswerKey {
        optionSetIds = optionSetIds == null ? Set.of() : Set.copyOf(optionSetIds);
    }
}
