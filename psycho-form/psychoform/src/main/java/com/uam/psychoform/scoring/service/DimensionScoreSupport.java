package com.uam.psychoform.scoring.service;

import com.uam.psychoform.instrument.model.Baremo;
import com.uam.psychoform.instrument.model.DimensionResultado;
import com.uam.psychoform.instrument.model.RangoBaremo;
import com.uam.psychoform.instrument.repository.BaremoRepository;
import com.uam.psychoform.instrument.repository.DimensionResultadoLookupRepository;
import com.uam.psychoform.instrument.repository.RangoBaremoRepository;
import com.uam.psychoform.scoring.model.ResultadoDimension;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Logica comun del puntaje por dimension/subtest que usan la calificacion y la resolucion de revisiones manuales:
 * que dimension recibe el puntaje de un subtest y como se resuelve su baremo/rango a partir del puntaje directo.
 */
@Component
class DimensionScoreSupport {
    private final DimensionResultadoLookupRepository dimensiones;
    private final BaremoRepository baremos;
    private final RangoBaremoRepository rangosBaremo;

    DimensionScoreSupport(DimensionResultadoLookupRepository dimensiones, BaremoRepository baremos,
            RangoBaremoRepository rangosBaremo) {
        this.dimensiones = dimensiones;
        this.baremos = baremos;
        this.rangosBaremo = rangosBaremo;
    }

    /** Dimension (la primera por orden de presentacion) que recibe el puntaje de cada subtest de la version. */
    Map<Long, DimensionResultado> dimensionsBySubtest(Long versionTestId) {
        Map<Long, DimensionResultado> bySubtest = new LinkedHashMap<>();
        for (DimensionResultado dimension : dimensiones.findActiveSubtestDimensionsByVersionId(versionTestId)) {
            bySubtest.putIfAbsent(dimension.getSubtest().getId(), dimension);
        }
        return bySubtest;
    }

    /**
     * Resuelve baremo y rango de cada fila segun su puntaje directo actual. Si el puntaje cae fuera de todo rango (o
     * no hay baremo) se limpian los campos derivados, para que un recalculo no deje un rango obsoleto.
     */
    void applyBaremo(Long versionTestId, Collection<ResultadoDimension> rows) {
        if (rows.isEmpty()) {
            return;
        }
        List<Long> dimensionIds = rows.stream().map(row -> row.getDimensionResultado().getId()).toList();
        Map<Long, Baremo> preferredBaremosByDimension = baremos.findPreferredDimensionBaremos(versionTestId, dimensionIds)
                .stream()
                .collect(Collectors.toMap(baremo -> baremo.getDimensionResultado().getId(), Function.identity(),
                        (first, second) -> first));
        List<Long> baremoIds = preferredBaremosByDimension.values().stream().map(Baremo::getId).toList();
        Map<Long, List<RangoBaremo>> rangesByBaremo = baremoIds.isEmpty()
                ? Map.of()
                : rangosBaremo.findByBaremoIdInOrderByBaremoAndRangeOrder(baremoIds).stream()
                        .collect(Collectors.groupingBy(range -> range.getBaremo().getId()));
        for (ResultadoDimension row : rows) {
            Baremo baremo = preferredBaremosByDimension.get(row.getDimensionResultado().getId());
            row.setBaremo(baremo);
            RangoBaremo range = baremo == null ? null
                    : matchingRange(rangesByBaremo.getOrDefault(baremo.getId(), List.of()), row.getPuntajeDirecto());
            applyRange(row, range);
        }
    }

    private static RangoBaremo matchingRange(List<RangoBaremo> ranges, BigDecimal score) {
        return ranges.stream()
                .filter(range -> range.getPuntajeMinimo().compareTo(score) <= 0
                        && range.getPuntajeMaximo().compareTo(score) >= 0)
                .findFirst()
                .orElse(null);
    }

    private static void applyRange(ResultadoDimension row, RangoBaremo range) {
        row.setRangoBaremo(range);
        row.setCategoria(range == null ? null : range.getCategoria());
        row.setPercentil(range == null ? null : range.getPercentil());
        row.setInterpretacion(range == null ? null : range.getInterpretacion());
        row.setPuntajeTransformado(range == null ? null : range.getPercentil());
    }
}
