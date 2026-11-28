package com.uam.psychoform.scoring.service.strategy;

import java.math.BigDecimal;

/**
 * Puntaje de una dimension de resultado. {@code transformedScore} (T, tipica, eneatipo...) lo calcula la estrategia o
 * queda en null.
 */
public record DimensionScore(long dimensionId, BigDecimal directScore, BigDecimal transformedScore, String note) {
}
