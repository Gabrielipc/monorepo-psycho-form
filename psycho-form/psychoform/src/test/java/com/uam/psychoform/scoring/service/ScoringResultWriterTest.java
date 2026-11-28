package com.uam.psychoform.scoring.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.instrument.model.Baremo;
import com.uam.psychoform.instrument.model.DimensionResultado;
import com.uam.psychoform.instrument.model.RangoBaremo;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import com.uam.psychoform.instrument.repository.BaremoRepository;
import com.uam.psychoform.instrument.repository.RangoBaremoRepository;
import com.uam.psychoform.scoring.model.CalificacionRespuesta;
import com.uam.psychoform.scoring.model.Resultado;
import com.uam.psychoform.scoring.model.ResultadoDimension;
import com.uam.psychoform.scoring.repository.CalificacionRespuestaRepository;
import com.uam.psychoform.scoring.repository.ResultadoDimensionRepository;
import com.uam.psychoform.scoring.repository.ResultadoRepository;
import com.uam.psychoform.scoring.repository.RevisionManualRespuestaRepository;
import com.uam.psychoform.scoring.service.strategy.DimensionScore;
import com.uam.psychoform.scoring.service.strategy.ItemScore;
import com.uam.psychoform.scoring.service.strategy.ScoringContext;
import com.uam.psychoform.scoring.service.strategy.ScoringContextBuilder;
import com.uam.psychoform.scoring.service.strategy.ScoringOutcome;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

/** R3: los puntajes se normalizan a escala 2 (HALF_UP) antes de resolver el baremo y de persistir. */
class ScoringResultWriterTest {
    private static final long VERSION = 100L;
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-06-24T12:00:00Z"), ZoneOffset.UTC);

    private final ResultadoRepository resultados = Mockito.mock(ResultadoRepository.class);
    private final CalificacionRespuestaRepository calificaciones = Mockito.mock(CalificacionRespuestaRepository.class);
    private final ResultadoDimensionRepository resultadosDimension = Mockito.mock(ResultadoDimensionRepository.class);
    private final RevisionManualRespuestaRepository revisiones = Mockito.mock(RevisionManualRespuestaRepository.class);
    private final BaremoRepository baremos = Mockito.mock(BaremoRepository.class);
    private final RangoBaremoRepository rangos = Mockito.mock(RangoBaremoRepository.class);
    private final ScoringResultWriter writer = new ScoringResultWriter(resultados, calificaciones,
            resultadosDimension, revisiones, new BaremoResolver(baremos, rangos), EntityReferences.entityManager(),
            CLOCK);

    private ScoringOutcome outcome() {
        BigDecimal contribution = new BigDecimal("3.00").multiply(new BigDecimal("0.3333")); // 0.999900
        return new ScoringOutcome(contribution,
                List.of(new ItemScore(31L, 10L, null, null, contribution, true, false, 5L, null)),
                List.of(new DimensionScore(5L, contribution, new BigDecimal("1.2345"), null)));
    }

    private void baremoConRangoDeUnoADos() {
        Baremo baremo = new Baremo();
        baremo.setId(7L);
        baremo.setCodigoBaremo("B7");
        DimensionResultado dimension = new DimensionResultado();
        dimension.setId(5L);
        baremo.setDimensionResultado(dimension);
        when(baremos.findCandidatesByDimensions(Mockito.eq(VERSION), Mockito.anyCollection()))
                .thenReturn(List.of(baremo));
        RangoBaremo bajo = rango(baremo, 70L, 1, "0.00", "0.99", "BAJO");
        RangoBaremo medio = rango(baremo, 71L, 2, "1.00", "2.00", "MEDIO");
        when(rangos.findByBaremoIdInOrderByBaremoAndRangeOrder(Mockito.anyCollection()))
                .thenReturn(List.of(bajo, medio));
    }

    private static RangoBaremo rango(Baremo baremo, long id, int order, String min, String max, String category) {
        RangoBaremo range = new RangoBaremo();
        range.setId(id);
        range.setBaremo(baremo);
        range.setOrden(order);
        range.setPuntajeMinimo(new BigDecimal(min));
        range.setPuntajeMaximo(new BigDecimal(max));
        range.setCategoria(category);
        return range;
    }

    private ScoringContext context() {
        return ScoringContextBuilder.forVersion(VERSION, "CLAVE_SIMPLE").subtest(1L, "S1")
                .item(10L, 1L, "I1", TipoRespuesta.OPCION_UNICA).context();
    }

    @Test
    void writeNormalizaAEscala2AntesDeResolverElBaremoYGuardaElMismoValor() {
        baremoConRangoDeUnoADos();

        Resultado resultado = writer.write(new IntentoTest(), null, null, outcome(), context());

        assertThat(resultado.getPuntajeTotalDirecto()).isEqualTo(new BigDecimal("1.00"));
        ArgumentCaptor<CalificacionRespuesta> grading = ArgumentCaptor.forClass(CalificacionRespuesta.class);
        Mockito.verify(calificaciones).save(grading.capture());
        assertThat(grading.getValue().getPuntajeObtenido()).isEqualTo(new BigDecimal("1.00"));
        ArgumentCaptor<ResultadoDimension> row = ArgumentCaptor.forClass(ResultadoDimension.class);
        Mockito.verify(resultadosDimension).save(row.capture());
        assertThat(row.getValue().getPuntajeDirecto()).isEqualTo(new BigDecimal("1.00"));
        assertThat(row.getValue().getPuntajeTransformado()).isEqualTo(new BigDecimal("1.23"));
        assertThat(row.getValue().getCategoria()).isEqualTo("MEDIO");
    }

    @Test
    void reconcileNormalizaTambienAntesDeResolverElBaremo() {
        baremoConRangoDeUnoADos();
        Resultado existing = new Resultado();
        existing.setId(70L);
        when(calificaciones.findByResultadoId(70L)).thenReturn(List.of());
        when(resultadosDimension.findByResultadoId(70L)).thenReturn(List.of());

        writer.reconcile(existing, outcome(), context());

        assertThat(existing.getPuntajeTotalDirecto()).isEqualTo(new BigDecimal("1.00"));
        ArgumentCaptor<ResultadoDimension> row = ArgumentCaptor.forClass(ResultadoDimension.class);
        Mockito.verify(resultadosDimension).save(row.capture());
        assertThat(row.getValue().getPuntajeDirecto()).isEqualTo(new BigDecimal("1.00"));
        assertThat(row.getValue().getCategoria()).isEqualTo("MEDIO");
        assertThat(Set.of(row.getValue().getRangoBaremo().getId())).containsExactly(71L);
    }
}
