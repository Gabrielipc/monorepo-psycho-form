package com.uam.psychoform.scoring.service;

import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.assessment.model.RespuestaItem;
import com.uam.psychoform.instrument.model.DimensionResultado;
import com.uam.psychoform.instrument.model.EstrategiaCalificacion;
import com.uam.psychoform.instrument.model.OpcionItem;
import com.uam.psychoform.instrument.model.ReglaCalificacion;
import com.uam.psychoform.scoring.model.CalificacionRespuesta;
import com.uam.psychoform.scoring.model.EstadoRevisionManual;
import com.uam.psychoform.scoring.model.Resultado;
import com.uam.psychoform.scoring.model.ResultadoDimension;
import com.uam.psychoform.scoring.model.RevisionManualRespuesta;
import com.uam.psychoform.scoring.repository.CalificacionRespuestaRepository;
import com.uam.psychoform.scoring.repository.ResultadoDimensionRepository;
import com.uam.psychoform.scoring.repository.ResultadoRepository;
import com.uam.psychoform.scoring.repository.RevisionManualRespuestaRepository;
import com.uam.psychoform.scoring.service.strategy.AnswerSnapshot;
import com.uam.psychoform.scoring.service.strategy.DimensionScore;
import com.uam.psychoform.scoring.service.strategy.ItemScore;
import com.uam.psychoform.scoring.service.strategy.ScoringContext;
import com.uam.psychoform.scoring.service.strategy.ScoringOutcome;
import com.uam.psychoform.security.model.Usuario;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Persiste el {@link ScoringOutcome} de una estrategia: resultado, calificaciones por respuesta, resultados por
 * dimension (con su baremo) y revisiones manuales pendientes. No decide nada de calificacion.
 */
@Component
@Transactional
public class ScoringResultWriter {
    private static final String ESTADO_CALCULADO = "CALCULADO";

    private final ResultadoRepository resultados;
    private final CalificacionRespuestaRepository calificaciones;
    private final ResultadoDimensionRepository resultadosDimension;
    private final RevisionManualRespuestaRepository revisiones;
    private final BaremoResolver baremoResolver;
    private final EntityManager em;
    private final Clock clock;

    public ScoringResultWriter(ResultadoRepository resultados, CalificacionRespuestaRepository calificaciones,
            ResultadoDimensionRepository resultadosDimension, RevisionManualRespuestaRepository revisiones,
            BaremoResolver baremoResolver, EntityManager em, Clock clock) {
        this.resultados = resultados;
        this.calificaciones = calificaciones;
        this.resultadosDimension = resultadosDimension;
        this.revisiones = revisiones;
        this.baremoResolver = baremoResolver;
        this.em = em;
        this.clock = clock;
    }

    /** Crea el resultado del intento con todas sus filas. */
    public Resultado write(IntentoTest intento, EstrategiaCalificacion estrategia, Usuario actor,
            ScoringOutcome outcome, ScoringContext context) {
        Resultado resultado = new Resultado();
        resultado.setIntento(intento);
        resultado.setEstrategiaCalificacion(estrategia);
        resultado.setCalculadoPor(actor);
        resultado.setCalculadoEn(LocalDateTime.now(clock));
        resultado.setEstado(ESTADO_CALCULADO);
        applyTotals(resultado, outcome);
        resultados.save(resultado);

        for (ItemScore item : outcome.items()) {
            CalificacionRespuesta grading = new CalificacionRespuesta();
            grading.setResultado(resultado);
            grading.setRespuesta(em.getReference(RespuestaItem.class, item.answerId()));
            grading.setCreadoEn(LocalDateTime.now(clock));
            applyGrading(grading, item);
            calificaciones.save(grading);
        }
        Map<Long, AppliedNorm> norms = resolveNorms(context, outcome);
        for (DimensionScore dimension : outcome.dimensions()) {
            ResultadoDimension row = new ResultadoDimension();
            row.setResultado(resultado);
            row.setDimensionResultado(em.getReference(DimensionResultado.class, dimension.dimensionId()));
            applyDimension(row, dimension, norms.get(dimension.dimensionId()), resultado);
            resultadosDimension.save(row);
        }
        createMissingReviews(outcome, context);
        return resultado;
    }

    /**
     * Recalcula un resultado existente actualizando en sitio: totales, calificaciones (por respuesta) y dimensiones (por
     * dimension) se actualizan, insertan o borran segun el nuevo resultado. No cambia el intento del resultado.
     */
    public void reconcile(Resultado existing, ScoringOutcome outcome, ScoringContext context) {
        applyTotals(existing, outcome);
        resultados.save(existing);

        Map<Long, CalificacionRespuesta> gradingsByAnswer = new LinkedHashMap<>();
        for (CalificacionRespuesta grading : calificaciones.findByResultadoId(existing.getId())) {
            gradingsByAnswer.put(grading.getRespuesta().getId(), grading);
        }
        for (ItemScore item : outcome.items()) {
            CalificacionRespuesta grading = gradingsByAnswer.remove(item.answerId());
            if (grading == null) {
                grading = new CalificacionRespuesta();
                grading.setResultado(existing);
                grading.setRespuesta(em.getReference(RespuestaItem.class, item.answerId()));
                grading.setCreadoEn(LocalDateTime.now(clock));
            }
            applyGrading(grading, item);
            calificaciones.save(grading);
        }
        if (!gradingsByAnswer.isEmpty()) {
            calificaciones.deleteAll(gradingsByAnswer.values());
        }

        Map<Long, ResultadoDimension> rowsByDimension = new LinkedHashMap<>();
        for (ResultadoDimension row : resultadosDimension.findByResultadoId(existing.getId())) {
            rowsByDimension.put(row.getDimensionResultado().getId(), row);
        }
        Map<Long, AppliedNorm> norms = resolveNorms(context, outcome);
        for (DimensionScore dimension : outcome.dimensions()) {
            ResultadoDimension row = rowsByDimension.remove(dimension.dimensionId());
            if (row == null) {
                row = new ResultadoDimension();
                row.setResultado(existing);
                row.setDimensionResultado(em.getReference(DimensionResultado.class, dimension.dimensionId()));
            }
            applyDimension(row, dimension, norms.get(dimension.dimensionId()), existing);
            resultadosDimension.save(row);
        }
        if (!rowsByDimension.isEmpty()) {
            resultadosDimension.deleteAll(rowsByDimension.values());
        }
        createMissingReviews(outcome, context);
    }

    /**
     * Recalificar no crea otro resultado (hay uno por intento): solo garantiza que cada calificacion con revision
     * manual pendiente tenga su revision, sin duplicar ni tocar las ya existentes (incluidas las resueltas).
     */
    public Resultado ensurePendingReviews(Resultado resultado) {
        List<CalificacionRespuesta> pending = calificaciones.findByResultadoId(resultado.getId()).stream()
                .filter(c -> Boolean.TRUE.equals(c.getRequiereRevisionManual()))
                .toList();
        if (pending.isEmpty()) {
            return resultado;
        }
        Set<Long> answersWithReview = revisiones
                .findByRespuestaIdIn(pending.stream().map(c -> c.getRespuesta().getId()).toList()).stream()
                .map(review -> review.getRespuesta().getId())
                .collect(Collectors.toSet());
        for (CalificacionRespuesta calificacion : pending) {
            if (!answersWithReview.contains(calificacion.getRespuesta().getId())) {
                createPendingReview(calificacion.getRespuesta(), calificacion.getReglaCalificacion());
            }
        }
        return resultado;
    }

    private void applyTotals(Resultado resultado, ScoringOutcome outcome) {
        int items = outcome.items().size();
        int correct = (int) outcome.items().stream().filter(item -> Boolean.TRUE.equals(item.correct())).count();
        int pending = (int) outcome.items().stream().filter(ItemScore::pendingManualReview).count();
        resultado.setPuntajeTotalDirecto(outcome.totalDirectScore());
        resultado.setCantidadItems(items);
        resultado.setCantidadCorrectas(correct);
        resultado.setCantidadIncorrectas(items - correct);
        resultado.setCantidadPendientesRevision(pending);
        resultado.setRequiereRevisionManual(pending > 0);
    }

    private void applyGrading(CalificacionRespuesta grading, ItemScore item) {
        grading.setReglaCalificacion(item.ruleId() == null ? null
                : em.getReference(ReglaCalificacion.class, item.ruleId()));
        grading.setOpcion(item.optionId() == null ? null : em.getReference(OpcionItem.class, item.optionId()));
        grading.setDimensionResultado(item.dimensionId() == null ? null
                : em.getReference(DimensionResultado.class, item.dimensionId()));
        grading.setPuntajeObtenido(item.score());
        grading.setEsCorrecta(item.correct());
        grading.setRequiereRevisionManual(item.pendingManualReview());
        grading.setObservacion(item.note());
    }

    private Map<Long, AppliedNorm> resolveNorms(ScoringContext context, ScoringOutcome outcome) {
        Map<Long, BigDecimal> scores = new HashMap<>();
        outcome.dimensions().forEach(dimension -> scores.put(dimension.dimensionId(), dimension.directScore()));
        return baremoResolver.resolveDimensions(context.configuration().versionId(), context.attempt().profile(),
                scores);
    }

    /** Aplica puntajes, baremo y rango; si no hay norma o rango se limpian los campos derivados. */
    private void applyDimension(ResultadoDimension row, DimensionScore dimension, AppliedNorm norm,
            Resultado resultado) {
        row.setPuntajeDirecto(dimension.directScore());
        row.setPuntajeTransformado(dimension.transformedScore());
        row.setObservacion(dimension.note());
        row.setRequiereRevisionManual(resultado.getRequiereRevisionManual());
        row.setBaremo(norm == null ? null : norm.baremo());
        var range = norm == null ? null : norm.range();
        row.setRangoBaremo(range);
        row.setCategoria(range == null ? null : range.getCategoria());
        row.setPercentil(range == null ? null : range.getPercentil());
        row.setInterpretacion(range == null ? null : range.getInterpretacion());
    }

    private void createMissingReviews(ScoringOutcome outcome, ScoringContext context) {
        Map<Long, AnswerSnapshot> answersById = context.attempt().answersByItem().values().stream()
                .collect(Collectors.toMap(AnswerSnapshot::answerId, answer -> answer, (first, second) -> first));
        for (ItemScore item : outcome.items()) {
            AnswerSnapshot answer = answersById.get(item.answerId());
            if (item.pendingManualReview() && answer != null && answer.review() == null) {
                createPendingReview(em.getReference(RespuestaItem.class, item.answerId()),
                        item.ruleId() == null ? null : em.getReference(ReglaCalificacion.class, item.ruleId()));
            }
        }
    }

    private void createPendingReview(RespuestaItem respuesta, ReglaCalificacion regla) {
        RevisionManualRespuesta review = new RevisionManualRespuesta();
        review.setRespuesta(respuesta);
        review.setReglaCalificacion(regla);
        review.setEstado(EstadoRevisionManual.PENDIENTE);
        review.setCreadoEn(LocalDateTime.now(clock));
        revisiones.save(review);
    }
}
