package com.uam.psychoform.scoring.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.uam.psychoform.assessment.model.AsignacionTest;
import com.uam.psychoform.assessment.model.EstadoIntento;
import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.assessment.model.RespuestaItem;
import com.uam.psychoform.assessment.model.SesionAplicacion;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.instrument.model.Baremo;
import com.uam.psychoform.instrument.model.DimensionResultado;
import com.uam.psychoform.instrument.model.EstadoVersionTest;
import com.uam.psychoform.instrument.model.EstrategiaCalificacion;
import com.uam.psychoform.instrument.model.RangoBaremo;
import com.uam.psychoform.instrument.model.ReglaCalificacion;
import com.uam.psychoform.instrument.model.TipoEstrategiaCalificacion;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.instrument.repository.BaremoRepository;
import com.uam.psychoform.instrument.repository.RangoBaremoRepository;
import com.uam.psychoform.scoring.model.CalificacionRespuesta;
import com.uam.psychoform.scoring.model.EstadoRevisionManual;
import com.uam.psychoform.scoring.model.Resultado;
import com.uam.psychoform.scoring.model.ResultadoDimension;
import com.uam.psychoform.scoring.model.RevisionManualRespuesta;
import com.uam.psychoform.scoring.repository.CalificacionRespuestaRepository;
import com.uam.psychoform.scoring.repository.ResultadoDimensionRepository;
import com.uam.psychoform.scoring.repository.ResultadoRepository;
import com.uam.psychoform.scoring.repository.RevisionManualRespuestaRepository;
import com.uam.psychoform.scoring.service.strategy.ClaveSimpleScoringStrategy;
import com.uam.psychoform.scoring.service.strategy.DimensionScore;
import com.uam.psychoform.scoring.service.strategy.ItemScore;
import com.uam.psychoform.scoring.service.strategy.ScoringContext;
import com.uam.psychoform.scoring.service.strategy.ScoringContextBuilder;
import com.uam.psychoform.scoring.service.strategy.ScoringOutcome;
import com.uam.psychoform.scoring.service.strategy.ScoringStrategy;
import com.uam.psychoform.scoring.service.strategy.StrategyDescriptor;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.security.access.prepost.PreAuthorize;

class ScoringServiceTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-06-24T12:00:00Z"), ZoneOffset.UTC);

    private final IntentoTestRepository intentos = Mockito.mock(IntentoTestRepository.class);
    private final ResultadoRepository resultados = Mockito.mock(ResultadoRepository.class);
    private final CalificacionRespuestaRepository calificaciones = Mockito.mock(CalificacionRespuestaRepository.class);
    private final ResultadoDimensionRepository resultadosDimension = Mockito.mock(ResultadoDimensionRepository.class);
    private final RevisionManualRespuestaRepository revisiones = Mockito.mock(RevisionManualRespuestaRepository.class);
    private final BaremoRepository baremos = Mockito.mock(BaremoRepository.class);
    private final RangoBaremoRepository rangosBaremo = Mockito.mock(RangoBaremoRepository.class);
    private final UsuarioRepository usuarios = Mockito.mock(UsuarioRepository.class);
    private final CurrentActor currentActor = Mockito.mock(CurrentActor.class);
    private final ScoringContextLoader loader = Mockito.mock(ScoringContextLoader.class);
    private final FixedOutcomeStrategy fixed = new FixedOutcomeStrategy();
    private final ScoringResultWriter writer = new ScoringResultWriter(resultados, calificaciones, resultadosDimension,
            revisiones, new BaremoResolver(baremos, rangosBaremo), EntityReferences.entityManager(), CLOCK);
    private final ScoringService service = new ScoringService(intentos, resultados,
            new ScoringStrategyRegistry(List.of(new ClaveSimpleScoringStrategy(), fixed)), loader, writer, usuarios,
            currentActor);

    @Test
    void scoreAttemptRequierePermisoCalificacion() throws Exception {
        Method method = ScoringService.class.getMethod("scoreAttempt", long.class);

        assertThat(method.getAnnotation(PreAuthorize.class).value())
                .isEqualTo("hasAuthority('PERM_CALIFICACION_EJECUTAR')");
    }

    // ---- idempotencia ----

    @Test
    void scoreAttemptRetornaResultadoExistenteSinDuplicar() {
        Resultado existente = new Resultado();
        existente.setId(70L);
        when(intentos.findByIdForUpdate(7L)).thenReturn(Optional.of(new IntentoTest()));
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.of(existente));

        assertThat(service.scoreAttempt(7L)).isSameAs(existente);

        verify(resultados, never()).save(Mockito.any());
        verify(intentos).findByIdForUpdate(7L);
        verify(loader, never()).load(Mockito.any());
    }

    @Test
    void recalificarNoDuplicaRevisionesExistentes() {
        RespuestaItem r1 = respuesta(31L);
        RespuestaItem r2 = respuesta(32L);
        Resultado existente = new Resultado();
        existente.setId(70L);
        when(intentos.findByIdForUpdate(7L)).thenReturn(Optional.of(new IntentoTest()));
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.of(existente));
        when(calificaciones.findByResultadoId(70L)).thenReturn(List.of(calificacionManual(r1), calificacionManual(r2)));
        when(revisiones.findByRespuestaIdIn(List.of(31L, 32L))).thenReturn(List.of(
                revision(r1, EstadoRevisionManual.PENDIENTE), revision(r2, EstadoRevisionManual.PENDIENTE)));

        assertThat(service.scoreAttempt(7L)).isSameAs(existente);

        verify(revisiones, never()).save(Mockito.any());
    }

    @Test
    void recalificarCreaSoloLasRevisionesQueFaltan() {
        RespuestaItem r1 = respuesta(31L);
        RespuestaItem r2 = respuesta(32L);
        Resultado existente = new Resultado();
        existente.setId(70L);
        when(intentos.findByIdForUpdate(7L)).thenReturn(Optional.of(new IntentoTest()));
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.of(existente));
        when(calificaciones.findByResultadoId(70L)).thenReturn(List.of(calificacionManual(r1), calificacionManual(r2)));
        when(revisiones.findByRespuestaIdIn(List.of(31L, 32L)))
                .thenReturn(List.of(revision(r1, EstadoRevisionManual.OBSERVADO)));

        service.scoreAttempt(7L);

        verify(revisiones, times(1)).save(Mockito.argThat(review -> review.getRespuesta() == r2));
    }

    // ---- validaciones de estado ----

    @Test
    void scoreAttemptRechazaIntentoNoCompletado() {
        IntentoTest intento = intentoPublicado("CLAVE_SIMPLE");
        intento.setEstado(EstadoIntento.EN_PROGRESO);
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.empty());
        when(intentos.findByIdForUpdate(7L)).thenReturn(Optional.of(intento));

        assertThatThrownBy(() -> service.scoreAttempt(7L)).isInstanceOf(IllegalStateException.class)
                .hasMessage("El intento debe estar finalizado para calificar");
    }

    @Test
    void scoreAttemptRechazaVersionNoPublicada() {
        IntentoTest intento = intentoPublicado("CLAVE_SIMPLE");
        intento.getAsignacion().getSesionAplicacion().getVersionTest().setEstado(EstadoVersionTest.APROBADO);
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.empty());
        when(intentos.findByIdForUpdate(7L)).thenReturn(Optional.of(intento));

        assertThatThrownBy(() -> service.scoreAttempt(7L)).isInstanceOf(IllegalStateException.class)
                .hasMessage("La version del test no esta publicada");
    }

    @Test
    void scoreAttemptRechazaEstrategiaSinImplementacion() {
        IntentoTest intento = intentoPublicado("LIKERT_ESCALA");
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.empty());
        when(intentos.findByIdForUpdate(7L)).thenReturn(Optional.of(intento));

        assertThatThrownBy(() -> service.scoreAttempt(7L)).isInstanceOf(IllegalStateException.class)
                .hasMessage("La estrategia LIKERT_ESCALA no tiene implementacion registrada");
        verify(resultados, never()).save(Mockito.any());
    }

    // ---- persistencia ----

    @Test
    void scoreAttemptPersisteResultadoCalificacionesYActorActual() {
        Usuario actor = preparar("CLAVE_SIMPLE", ScoringContextBuilder.forVersion(100L, "CLAVE_SIMPLE")
                .subtest(5L, "FI")
                .item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA).option(10L, 20L, "A").option(10L, 21L, "B")
                .keyForOption(10L, 20L, "2.00")
                .item(11L, 5L, "FI-02", TipoRespuesta.OPCION_UNICA).option(11L, 22L, "A").option(11L, 23L, "B")
                .keyForOption(11L, 22L, "1.00")
                .answerOptions(10L, 30L, 20L).answerOptions(11L, 31L, 23L).context());

        Resultado resultado = service.scoreAttempt(7L);

        assertThat(resultado.getCalculadoPor()).isSameAs(actor);
        assertThat(resultado.getCalculadoEn()).isEqualTo(java.time.LocalDateTime.of(2026, 6, 24, 12, 0));
        assertThat(resultado.getEstado()).isEqualTo("CALCULADO");
        assertThat(resultado.getPuntajeTotalDirecto()).isEqualByComparingTo("2.00");
        assertThat(resultado.getCantidadItems()).isEqualTo(2);
        assertThat(resultado.getCantidadCorrectas()).isEqualTo(1);
        assertThat(resultado.getCantidadIncorrectas()).isEqualTo(1);
        assertThat(resultado.getCantidadPendientesRevision()).isZero();
        assertThat(resultado.getRequiereRevisionManual()).isFalse();
        assertThat(resultado.getEstrategiaCalificacion().getCodigo()).isEqualTo("CLAVE_SIMPLE");
        ArgumentCaptor<CalificacionRespuesta> saved = ArgumentCaptor.forClass(CalificacionRespuesta.class);
        verify(calificaciones, times(2)).save(saved.capture());
        CalificacionRespuesta first = saved.getAllValues().get(0);
        assertThat(first.getResultado()).isSameAs(resultado);
        assertThat(first.getRespuesta().getId()).isEqualTo(30L);
        assertThat(first.getReglaCalificacion().getId()).isEqualTo(ScoringContextBuilder.DEFAULT_RULE_ID);
        assertThat(first.getOpcion().getId()).isEqualTo(20L);
        assertThat(first.getEsCorrecta()).isTrue();
        assertThat(first.getRequiereRevisionManual()).isFalse();
        assertThat(first.getPuntajeObtenido()).isEqualByComparingTo("2.00");
        assertThat(saved.getAllValues().get(1).getEsCorrecta()).isFalse();
        verify(intentos).findByIdForUpdate(7L);
    }

    @Test
    void scoreAttemptCreaUnaRevisionPendientePorCadaItemPendienteYNoDuplicaLasExistentes() {
        preparar("CLAVE_SIMPLE", ScoringContextBuilder.forVersion(100L, "CLAVE_SIMPLE").subtest(5L, "FI")
                .item(10L, 5L, "FI-01", TipoRespuesta.TEXTO_ABIERTO).keyManual(10L, "5.00")
                .item(11L, 5L, "FI-02", TipoRespuesta.TEXTO_ABIERTO).keyManual(11L, "3.00")
                .item(12L, 5L, "FI-03", TipoRespuesta.TEXTO_ABIERTO).keyManual(12L, "3.00")
                .item(13L, 5L, "FI-04", TipoRespuesta.TEXTO_ABIERTO).keyText(13L, "x", "1.00")
                .answerText(10L, 30L, "a").answerText(11L, 31L, "b").answerText(12L, 32L, "c")
                .answerText(13L, 33L, "x")
                .review(12L, EstadoRevisionManual.OBSERVADO, null).context());

        Resultado resultado = service.scoreAttempt(7L);

        assertThat(resultado.getCantidadPendientesRevision()).isEqualTo(3);
        assertThat(resultado.getRequiereRevisionManual()).isTrue();
        assertThat(resultado.getPuntajeTotalDirecto()).isEqualByComparingTo("1.00");
        ArgumentCaptor<RevisionManualRespuesta> created = ArgumentCaptor.forClass(RevisionManualRespuesta.class);
        verify(revisiones, times(2)).save(created.capture());
        assertThat(created.getAllValues()).extracting(r -> r.getRespuesta().getId()).containsExactly(30L, 31L);
        assertThat(created.getAllValues()).allSatisfy(review -> {
            assertThat(review.getEstado()).isEqualTo(EstadoRevisionManual.PENDIENTE);
            assertThat(review.getReglaCalificacion().getId()).isEqualTo(ScoringContextBuilder.DEFAULT_RULE_ID);
        });
    }

    @Test
    void scoreAttemptPersisteDimensionesConBaremoYRango() {
        preparar("CLAVE_SIMPLE", ScoringContextBuilder.forVersion(100L, "CLAVE_SIMPLE").subtest(5L, "FI")
                .item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA).option(10L, 20L, "A").keyForOption(10L, 20L, "2.00")
                .dimension(60L, "FI", 5L, 1).answerOptions(10L, 30L, 20L).context());
        DimensionResultado dimension = new DimensionResultado();
        dimension.setId(60L);
        Baremo baremo = new Baremo();
        baremo.setId(70L);
        baremo.setDimensionResultado(dimension);
        RangoBaremo rango = new RangoBaremo();
        rango.setBaremo(baremo);
        rango.setPuntajeMinimo(BigDecimal.ZERO);
        rango.setPuntajeMaximo(new BigDecimal("5"));
        rango.setCategoria("Medio");
        rango.setPercentil(new BigDecimal("50"));
        rango.setInterpretacion("Interpretacion");
        rango.setOrden(1);
        when(baremos.findCandidatesByDimensions(Mockito.eq(100L), Mockito.anyCollection())).thenReturn(List.of(baremo));
        when(rangosBaremo.findByBaremoIdInOrderByBaremoAndRangeOrder(Mockito.anyCollection()))
                .thenReturn(List.of(rango));

        Resultado resultado = service.scoreAttempt(7L);

        ArgumentCaptor<ResultadoDimension> saved = ArgumentCaptor.forClass(ResultadoDimension.class);
        verify(resultadosDimension).save(saved.capture());
        ResultadoDimension row = saved.getValue();
        assertThat(row.getResultado()).isSameAs(resultado);
        assertThat(row.getDimensionResultado().getId()).isEqualTo(60L);
        assertThat(row.getPuntajeDirecto()).isEqualByComparingTo("2.00");
        assertThat(row.getPuntajeTransformado()).isNull();
        assertThat(row.getBaremo()).isSameAs(baremo);
        assertThat(row.getRangoBaremo()).isSameAs(rango);
        assertThat(row.getCategoria()).isEqualTo("Medio");
        assertThat(row.getPercentil()).isEqualByComparingTo("50");
        assertThat(row.getInterpretacion()).isEqualTo("Interpretacion");
        assertThat(row.getRequiereRevisionManual()).isFalse();
    }

    @Test
    void elPuntajeTransformadoLoDefineLaEstrategiaYNoSeCopiaElPercentil() {
        ScoringContext context = ScoringContextBuilder.forVersion(100L, "TEST_FIXED").subtest(5L, "FI")
                .item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA).option(10L, 20L, "A")
                .dimension(60L, "FI", 5L, 1).answerOptions(10L, 30L, 20L).context();
        preparar("TEST_FIXED", context);
        fixed.outcome = new ScoringOutcome(new BigDecimal("12.50"),
                List.of(new ItemScore(30L, 10L, null, null, new BigDecimal("12.50"), null, false, null, "nota")),
                List.of(new DimensionScore(60L, new BigDecimal("12.50"), new BigDecimal("55.00"), "obs")));
        DimensionResultado dimension = new DimensionResultado();
        dimension.setId(60L);
        Baremo baremo = new Baremo();
        baremo.setId(70L);
        baremo.setDimensionResultado(dimension);
        RangoBaremo rango = new RangoBaremo();
        rango.setBaremo(baremo);
        rango.setPuntajeMinimo(BigDecimal.ZERO);
        rango.setPuntajeMaximo(new BigDecimal("100"));
        rango.setCategoria("Alto");
        rango.setPercentil(new BigDecimal("99"));
        rango.setOrden(1);
        when(baremos.findCandidatesByDimensions(Mockito.eq(100L), Mockito.anyCollection())).thenReturn(List.of(baremo));
        when(rangosBaremo.findByBaremoIdInOrderByBaremoAndRangeOrder(Mockito.anyCollection()))
                .thenReturn(List.of(rango));

        Resultado resultado = service.scoreAttempt(7L);

        assertThat(resultado.getPuntajeTotalDirecto()).isEqualByComparingTo("12.50");
        // correct == null no cuenta como acierto: todas las filas no acertadas son incorrectas
        assertThat(resultado.getCantidadCorrectas()).isZero();
        assertThat(resultado.getCantidadIncorrectas()).isEqualTo(1);
        ArgumentCaptor<ResultadoDimension> saved = ArgumentCaptor.forClass(ResultadoDimension.class);
        verify(resultadosDimension).save(saved.capture());
        assertThat(saved.getValue().getPuntajeTransformado()).isEqualByComparingTo("55.00");
        assertThat(saved.getValue().getPercentil()).isEqualByComparingTo("99");
        assertThat(saved.getValue().getObservacion()).isEqualTo("obs");
        ArgumentCaptor<CalificacionRespuesta> grading = ArgumentCaptor.forClass(CalificacionRespuesta.class);
        verify(calificaciones).save(grading.capture());
        assertThat(grading.getValue().getObservacion()).isEqualTo("nota");
        assertThat(grading.getValue().getEsCorrecta()).isNull();
    }

    // ---- outcome invalido ----

    @Test
    void unOutcomeInvalidoEsUnDefectoDeLaEstrategiaYNoSePersiste() {
        ScoringContext context = ScoringContextBuilder.forVersion(100L, "TEST_FIXED").subtest(5L, "FI")
                .item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA).option(10L, 20L, "A")
                .dimension(60L, "FI", 5L, 1).answerOptions(10L, 30L, 20L).context();
        preparar("TEST_FIXED", context);
        BigDecimal one = BigDecimal.ONE;
        ItemScore ok = new ItemScore(30L, 10L, null, null, one, true, false, null, null);

        assertInvalid(new ScoringOutcome(null, List.of(), List.of()), "puntaje total");
        assertInvalid(new ScoringOutcome(one, List.of(new ItemScore(999L, 10L, null, null, one, true, false, null, null)),
                List.of()), "respuesta 999");
        assertInvalid(new ScoringOutcome(one, List.of(ok, ok), List.of()), "mas de una vez");
        assertInvalid(new ScoringOutcome(one, List.of(new ItemScore(30L, 10L, null, null, null, true, false, null, null)),
                List.of()), "sin puntaje");
        assertInvalid(new ScoringOutcome(one, List.of(new ItemScore(30L, 10L, 55L, null, one, true, false, null, null)),
                List.of()), "regla 55");
        assertInvalid(new ScoringOutcome(one, List.of(new ItemScore(30L, 10L, null, 55L, one, true, false, null, null)),
                List.of()), "opcion 55");
        assertInvalid(new ScoringOutcome(one, List.of(new ItemScore(30L, 10L, null, null, one, true, false, 55L, null)),
                List.of()), "dimension 55");
        assertInvalid(new ScoringOutcome(one, List.of(), List.of(new DimensionScore(55L, one, null, null))),
                "dimension 55");
        assertInvalid(new ScoringOutcome(one, List.of(), List.of(new DimensionScore(60L, one, null, null),
                new DimensionScore(60L, one, null, null))), "repetida");
        assertInvalid(new ScoringOutcome(one, List.of(), List.of(new DimensionScore(60L, null, null, null))),
                "sin puntaje directo");

        verify(resultados, never()).save(Mockito.any());
        verify(calificaciones, never()).save(Mockito.any());
        verify(resultadosDimension, never()).save(Mockito.any());
    }

    @Test
    void unOutcomeValidoSinFilasSePersisteConLosTotalesDeLaEstrategia() {
        preparar("TEST_FIXED", ScoringContextBuilder.forVersion(100L, "TEST_FIXED").subtest(5L, "FI")
                .item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA).option(10L, 20L, "A").context());
        fixed.outcome = new ScoringOutcome(new BigDecimal("7.25"), List.of(), List.of());

        Resultado resultado = service.scoreAttempt(7L);

        assertThat(resultado.getPuntajeTotalDirecto()).isEqualByComparingTo("7.25");
        assertThat(resultado.getCantidadItems()).isZero();
        verify(resultados).save(resultado);
    }

    private void assertInvalid(ScoringOutcome outcome, String fragment) {
        fixed.outcome = outcome;
        assertThatThrownBy(() -> service.scoreAttempt(7L)).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("TEST_FIXED").hasMessageContaining(fragment);
    }

    // ---- soporte ----

    /** Prepara un intento publicado con la estrategia dada y el contexto que devolvera el loader. */
    private Usuario preparar(String strategyCode, ScoringContext context) {
        UUID actorId = UUID.randomUUID();
        Usuario actor = new Usuario();
        actor.setId(actorId);
        IntentoTest intento = intentoPublicado(strategyCode);
        when(resultados.findByIntentoId(7L)).thenReturn(Optional.empty());
        when(intentos.findByIdForUpdate(7L)).thenReturn(Optional.of(intento));
        when(currentActor.usuarioId()).thenReturn(actorId);
        when(usuarios.findById(actorId)).thenReturn(Optional.of(actor));
        when(loader.load(intento)).thenReturn(context);
        return actor;
    }

    private static IntentoTest intentoPublicado(String strategyCode) {
        EstrategiaCalificacion estrategia = new EstrategiaCalificacion();
        estrategia.setCodigo(strategyCode);
        estrategia.setTipoEstrategia(TipoEstrategiaCalificacion.CLAVE_SIMPLE);
        VersionTest version = new VersionTest();
        version.setId(100L);
        version.setEstado(EstadoVersionTest.PUBLICADO);
        version.setEstrategiaCalificacion(estrategia);
        SesionAplicacion sesion = new SesionAplicacion();
        sesion.setVersionTest(version);
        AsignacionTest asignacion = new AsignacionTest();
        asignacion.setSesionAplicacion(sesion);
        IntentoTest intento = new IntentoTest();
        intento.setId(7L);
        intento.setEstado(EstadoIntento.COMPLETADO);
        intento.setAsignacion(asignacion);
        return intento;
    }

    private static RespuestaItem respuesta(Long id) {
        RespuestaItem respuesta = new RespuestaItem();
        respuesta.setId(id);
        return respuesta;
    }

    private static CalificacionRespuesta calificacionManual(RespuestaItem respuesta) {
        CalificacionRespuesta calificacion = new CalificacionRespuesta();
        calificacion.setRespuesta(respuesta);
        calificacion.setReglaCalificacion(new ReglaCalificacion());
        calificacion.setRequiereRevisionManual(true);
        return calificacion;
    }

    private static RevisionManualRespuesta revision(RespuestaItem respuesta, EstadoRevisionManual estado) {
        RevisionManualRespuesta review = new RevisionManualRespuesta();
        review.setRespuesta(respuesta);
        review.setEstado(estado);
        return review;
    }

    /** Estrategia de prueba que devuelve el outcome configurado (por defecto, vacio). */
    private static final class FixedOutcomeStrategy implements ScoringStrategy {
        ScoringOutcome outcome = new ScoringOutcome(BigDecimal.ZERO, List.of(), List.of());

        @Override
        public String code() {
            return "TEST_FIXED";
        }

        @Override
        public StrategyDescriptor descriptor() {
            return new StrategyDescriptor("TEST_FIXED", "Fija", null, TipoEstrategiaCalificacion.FORMULA_CONTROLADA,
                    false, false);
        }

        @Override
        public ScoringOutcome score(ScoringContext context) {
            return outcome;
        }
    }
}
