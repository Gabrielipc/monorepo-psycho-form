package com.uam.psychoform.scoring.service;

import com.uam.psychoform.instrument.model.Baremo;
import com.uam.psychoform.instrument.model.RangoBaremo;
import com.uam.psychoform.instrument.repository.BaremoRepository;
import com.uam.psychoform.instrument.repository.RangoBaremoRepository;
import com.uam.psychoform.scoring.service.strategy.NormativeProfile;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Elige el baremo (y su rango) que corresponde al perfil del participante y al puntaje, por dimension o para el total.
 * <p>
 * Un baremo aplica si cada criterio que define (edad, sexo, carrera, vigencia) coincide con el perfil; si exige un
 * criterio y el perfil no tiene ese dato, no aplica. Entre los que aplican se prefiere el mas especifico (mas criterios),
 * luego el aprobado mas recientemente y por ultimo el de mayor id.
 */
@Component
@Transactional(readOnly = true)
public class BaremoResolver {
    private static final Comparator<Baremo> PREFERENCE = Comparator
            .comparingInt(BaremoResolver::specificity).reversed()
            .thenComparing(Baremo::getAprobadoEn, Comparator.nullsLast(Comparator.reverseOrder()))
            .thenComparing(Baremo::getId, Comparator.nullsLast(Comparator.reverseOrder()));

    private final BaremoRepository baremos;
    private final RangoBaremoRepository rangos;

    public BaremoResolver(BaremoRepository baremos, RangoBaremoRepository rangos) {
        this.baremos = baremos;
        this.rangos = rangos;
    }

    /** Baremo de una dimension ({@code dimensionId}) o del total ({@code dimensionId == null}). */
    public Optional<AppliedNorm> resolve(long versionId, Long dimensionId, NormativeProfile profile,
            BigDecimal directScore) {
        if (dimensionId == null) {
            return applicable(baremos.findTotalCandidates(versionId), profile).stream()
                    .min(PREFERENCE)
                    .map(baremo -> new AppliedNorm(baremo, matchingRange(
                            loadRanges(List.of(baremo)).getOrDefault(baremo.getId(), List.of()), directScore)));
        }
        return Optional.ofNullable(resolveDimensions(versionId, profile, Map.of(dimensionId, directScore))
                .get(dimensionId));
    }

    /**
     * Resuelve varias dimensiones con una consulta de baremos y una de rangos. Las dimensiones sin baremo aplicable
     * no aparecen en el mapa.
     */
    public Map<Long, AppliedNorm> resolveDimensions(long versionId, NormativeProfile profile,
            Map<Long, BigDecimal> directScoresByDimension) {
        if (directScoresByDimension.isEmpty()) {
            return Map.of();
        }
        Map<Long, List<Baremo>> candidatesByDimension = baremos
                .findCandidatesByDimensions(versionId, directScoresByDimension.keySet()).stream()
                .collect(Collectors.groupingBy(baremo -> baremo.getDimensionResultado().getId()));
        Map<Long, Baremo> chosen = new LinkedHashMap<>();
        candidatesByDimension.forEach((dimensionId, candidates) -> applicable(candidates, profile).stream()
                .min(PREFERENCE)
                .ifPresent(baremo -> chosen.put(dimensionId, baremo)));
        Map<Long, List<RangoBaremo>> rangesByBaremo = loadRanges(chosen.values());
        Map<Long, AppliedNorm> result = new HashMap<>();
        chosen.forEach((dimensionId, baremo) -> result.put(dimensionId, new AppliedNorm(baremo,
                matchingRange(rangesByBaremo.getOrDefault(baremo.getId(), List.of()),
                        directScoresByDimension.get(dimensionId)))));
        return result;
    }

    private Map<Long, List<RangoBaremo>> loadRanges(Collection<Baremo> chosen) {
        List<Long> ids = chosen.stream().map(Baremo::getId).toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        return rangos.findByBaremoIdInOrderByBaremoAndRangeOrder(ids).stream()
                .collect(Collectors.groupingBy(range -> range.getBaremo().getId()));
    }

    private static List<Baremo> applicable(List<Baremo> candidates, NormativeProfile profile) {
        return candidates.stream().filter(baremo -> applies(baremo, profile)).toList();
    }

    static boolean applies(Baremo baremo, NormativeProfile profile) {
        if (hasAgeCriterion(baremo)) {
            Integer age = profile.age();
            if (age == null
                    || (baremo.getCriterioEdadMinima() != null && age < baremo.getCriterioEdadMinima())
                    || (baremo.getCriterioEdadMaxima() != null && age > baremo.getCriterioEdadMaxima())) {
                return false;
            }
        }
        if (baremo.getCriterioSexo() != null
                && (profile.sexId() == null || !profile.sexId().equals(baremo.getCriterioSexo().getId()))) {
            return false;
        }
        if (baremo.getCriterioCarrera() != null
                && (profile.careerId() == null || !profile.careerId().equals(baremo.getCriterioCarrera().getId()))) {
            return false;
        }
        if (hasValidityCriterion(baremo)) {
            LocalDate date = profile.applicationDate();
            return date != null
                    && (baremo.getVigenteDesde() == null || !date.isBefore(baremo.getVigenteDesde()))
                    && (baremo.getVigenteHasta() == null || !date.isAfter(baremo.getVigenteHasta()));
        }
        return true;
    }

    /** Cantidad de criterios definidos: edad, sexo, carrera y vigencia. */
    static int specificity(Baremo baremo) {
        return (hasAgeCriterion(baremo) ? 1 : 0) + (baremo.getCriterioSexo() != null ? 1 : 0)
                + (baremo.getCriterioCarrera() != null ? 1 : 0) + (hasValidityCriterion(baremo) ? 1 : 0);
    }

    private static boolean hasAgeCriterion(Baremo baremo) {
        return baremo.getCriterioEdadMinima() != null || baremo.getCriterioEdadMaxima() != null;
    }

    private static boolean hasValidityCriterion(Baremo baremo) {
        return baremo.getVigenteDesde() != null || baremo.getVigenteHasta() != null;
    }

    private static RangoBaremo matchingRange(List<RangoBaremo> ranges, BigDecimal score) {
        if (score == null) {
            return null;
        }
        return ranges.stream()
                .filter(range -> range.getPuntajeMinimo().compareTo(score) <= 0
                        && range.getPuntajeMaximo().compareTo(score) >= 0)
                .min(Comparator.comparing(RangoBaremo::getOrden, Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(RangoBaremo::getId, Comparator.nullsLast(Comparator.naturalOrder())))
                .orElse(null);
    }
}
