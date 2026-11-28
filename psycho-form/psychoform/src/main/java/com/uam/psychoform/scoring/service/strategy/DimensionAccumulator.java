package com.uam.psychoform.scoring.service.strategy;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Acumula puntajes directos por dimension (matriz opcion-dimension o dimension del subtest). Solo emite las
 * dimensiones que recibieron algun aporte. No es seguro entre hilos; se crea uno por calificacion.
 */
public final class DimensionAccumulator {
    private final ScoringConfiguration configuration;
    private final Map<Long, BigDecimal> directScores = new LinkedHashMap<>();

    public DimensionAccumulator(ScoringConfiguration configuration) {
        this.configuration = configuration;
    }

    /** Suma {@code score x weight} de las filas de matriz de cada opcion seleccionada. */
    public void addMatrix(AnswerSnapshot answer) {
        for (Long optionId : answer.selectedOptionIds()) {
            for (ScoringConfiguration.MatrixRow row : configuration.matrixForOption(optionId)) {
                add(row.dimensionId(), row.score().multiply(row.weight()));
            }
        }
    }

    /** Suma el puntaje a la dimension del subtest del item, si existe. */
    public void addToSubtestDimension(ScoringConfiguration.ItemInfo item, BigDecimal score) {
        configuration.dimensionOfSubtest(item.subtestId())
                .ifPresent(dimension -> add(dimension.id(), score));
    }

    /**
     * Regla de CLAVE_SIMPLE: items con revision manual y items automaticos sin matriz aportan su puntaje a la dimension
     * del subtest; items automaticos con matriz aportan la matriz de sus opciones seleccionadas.
     */
    public void addKeyed(KeyedItemGrader.GradedItem graded) {
        if (!graded.manualReview() && configuration.itemHasMatrix(graded.item().id())) {
            addMatrix(graded.answer());
        } else {
            addToSubtestDimension(graded.item(), graded.score().score());
        }
    }

    public void add(long dimensionId, BigDecimal contribution) {
        directScores.merge(dimensionId, contribution, BigDecimal::add);
    }

    /** Dimensiones con aporte, en orden de primera aparicion, sin puntaje transformado. */
    public List<DimensionScore> build() {
        List<DimensionScore> result = new ArrayList<>();
        directScores.forEach((id, score) -> result.add(new DimensionScore(id, score, null, null)));
        return result;
    }
}
