package com.uam.psychoform.scoring.service.strategy;

import java.math.BigDecimal;
import java.util.List;

/**
 * Resultado de una estrategia. El total directo lo define la estrategia (puede ser una formula distinta de la suma de
 * items). Hay una fila {@link ItemScore} por respuesta calificada y una {@link DimensionScore} por dimension con
 * puntaje.
 */
public record ScoringOutcome(BigDecimal totalDirectScore, List<ItemScore> items, List<DimensionScore> dimensions) {
    public ScoringOutcome {
        items = items == null ? List.of() : List.copyOf(items);
        dimensions = dimensions == null ? List.of() : List.copyOf(dimensions);
    }
}
