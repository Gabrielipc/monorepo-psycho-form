package com.uam.psychoform.scoring.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.uam.psychoform.academic.model.Participante;
import com.uam.psychoform.assessment.model.AsignacionTest;
import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.assessment.model.RespuestaItem;
import com.uam.psychoform.assessment.repository.RespuestaItemRepository;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.audit.service.AuditLogService;
import com.uam.psychoform.instrument.model.ClaveRespuesta;
import com.uam.psychoform.instrument.model.ReglaCalificacion;
import com.uam.psychoform.instrument.repository.ClaveRespuestaLookupRepository;
import com.uam.psychoform.scoring.model.CalificacionRespuesta;
import com.uam.psychoform.scoring.model.Resultado;
import com.uam.psychoform.scoring.model.ResultadoDimension;
import com.uam.psychoform.scoring.repository.CalificacionRespuestaRepository;
import com.uam.psychoform.scoring.repository.ResultadoDimensionRepository;
import com.uam.psychoform.scoring.repository.ResultadoRepository;
import com.uam.psychoform.instrument.model.Item;
import com.uam.psychoform.scoring.model.EstadoRevisionManual;
import com.uam.psychoform.scoring.model.RevisionManualRespuesta;
import com.uam.psychoform.scoring.repository.RevisionManualRespuestaRepository;
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
import org.mockito.Mockito;
import org.springframework.security.access.prepost.PreAuthorize;

class ManualReviewServiceTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-06-24T12:00:00Z"), ZoneOffset.UTC);

    private final RevisionManualRespuestaRepository reviews = Mockito.mock(RevisionManualRespuestaRepository.class);
    private final RespuestaItemRepository answers = Mockito.mock(RespuestaItemRepository.class);
    private final IntentoTestRepository attempts = Mockito.mock(IntentoTestRepository.class);
    private final ResultadoRepository results = Mockito.mock(ResultadoRepository.class);
    private final CalificacionRespuestaRepository gradings = Mockito.mock(CalificacionRespuestaRepository.class);
    private final ResultadoDimensionRepository dimensionResults = Mockito.mock(ResultadoDimensionRepository.class);
    private final ClaveRespuestaLookupRepository keys = Mockito.mock(ClaveRespuestaLookupRepository.class);
    private final UsuarioRepository users = Mockito.mock(UsuarioRepository.class);
    private final CurrentActor currentActor = Mockito.mock(CurrentActor.class);
    private final AuditLogService audit = Mockito.mock(AuditLogService.class);
    private final ManualReviewService service = new ManualReviewService(reviews, answers, attempts, results, gradings,
            dimensionResults, keys, users, currentActor, audit, CLOCK);

    @Test
    void metodosExponenPermisosCorrectos() throws Exception {
        Method pending = ManualReviewService.class.getMethod("pending");
        Method createPending = ManualReviewService.class.getMethod("createPendingForAnswer", Long.class);
        Method resolve = ManualReviewService.class.getMethod("resolve", Long.class, ManualReviewService.ReviewCommand.class);

        assertThat(pending.getAnnotation(PreAuthorize.class).value())
                .isEqualTo("hasAuthority('PERM_CALIFICACION_EJECUTAR') or hasAuthority('PERM_RESULTADO_VER')");
        assertThat(createPending.getAnnotation(PreAuthorize.class).value())
                .isEqualTo("hasAuthority('PERM_CALIFICACION_EJECUTAR')");
        assertThat(resolve.getAnnotation(PreAuthorize.class).value())
                .isEqualTo("hasAuthority('PERM_CALIFICACION_EJECUTAR')");
    }

    @Test
    void createPendingForAnswerMarcaRespuestaYCreaRevisionPendiente() {
        RespuestaItem answer = answerGraph(44L);
        when(answers.findById(44L)).thenReturn(Optional.of(answer));

        ManualReviewService.PendingReviewView view = service.createPendingForAnswer(44L);

        assertThat(answer.getRequiereRevisionManual()).isTrue();
        assertThat(view.answerId()).isEqualTo(44L);
        assertThat(view.status()).isEqualTo("PENDIENTE");
        verify(reviews).save(Mockito.argThat(review -> review.getRespuesta() == answer
                && review.getEstado() == EstadoRevisionManual.PENDIENTE
                && review.getCreadoEn().equals(CLOCK.instant().atZone(ZoneOffset.UTC).toLocalDateTime())));
        verify(answers).save(answer);
    }

    @Test
    void resolveAsignaPuntajeRevisorYAuditoria() {
        Escenario e = escenario(2);
        e.reviewerStubs();

        ManualReviewService.PendingReviewView view = service.resolve(e.reviews.get(0).getId(),
                new ManualReviewService.ReviewCommand(new BigDecimal("4.50"), "Correcto", true));

        assertThat(view.status()).isEqualTo("REVISADO");
        assertThat(e.reviews.get(0).getPuntajeAsignado()).isEqualByComparingTo("4.50");
        assertThat(e.reviews.get(0).getRevisadoPor()).isSameAs(e.reviewer);
        verify(reviews).save(e.reviews.get(0));
        verify(audit).recordTrusted(Mockito.argThat(event -> event.action().equals("REVISION_MANUAL_GUARDADA")
                && event.entity().equals("revision_manual_respuesta")
                && event.entityId().equals(String.valueOf(e.reviews.get(0).getId()))));
    }

    @Test
    void resolverUnaSolaRevisionAplicaSuPuntajeYSigueRequiriendoRevision() {
        Escenario e = escenario(2);
        e.reviewerStubs();

        service.resolve(e.reviews.get(0).getId(), new ManualReviewService.ReviewCommand(new BigDecimal("4.50"), "ok", true));

        assertThat(e.gradingList.get(0).getPuntajeObtenido()).isEqualByComparingTo("4.50");
        assertThat(e.gradingList.get(0).getEsCorrecta()).isTrue();
        assertThat(e.gradingList.get(0).getRequiereRevisionManual()).isFalse();
        assertThat(e.gradingList.get(1).getRequiereRevisionManual()).isTrue();
        assertThat(e.result.getPuntajeTotalDirecto()).isEqualByComparingTo("4.50");
        assertThat(e.result.getCantidadCorrectas()).isEqualTo(1);
        assertThat(e.result.getCantidadIncorrectas()).isEqualTo(1);
        assertThat(e.result.getCantidadPendientesRevision()).isEqualTo(1);
        assertThat(e.result.getRequiereRevisionManual()).isTrue();
        assertThat(e.dimension.getRequiereRevisionManual()).isTrue();
    }

    @Test
    void resolverTodasLasRevisionesIncluyeSusPuntajesYQuitaLaMarcaDeRevision() {
        Escenario e = escenario(2);
        e.reviewerStubs();

        service.resolve(e.reviews.get(0).getId(), new ManualReviewService.ReviewCommand(new BigDecimal("4.50"), "ok", true));
        service.resolve(e.reviews.get(1).getId(), new ManualReviewService.ReviewCommand(BigDecimal.ZERO, "nada", true));

        assertThat(e.result.getPuntajeTotalDirecto()).isEqualByComparingTo("4.50");
        assertThat(e.result.getCantidadCorrectas()).isEqualTo(1);
        assertThat(e.result.getCantidadIncorrectas()).isEqualTo(1);
        assertThat(e.result.getCantidadPendientesRevision()).isZero();
        assertThat(e.result.getRequiereRevisionManual()).isFalse();
        assertThat(e.dimension.getRequiereRevisionManual()).isFalse();
        assertThat(e.gradingList.get(1).getEsCorrecta()).isFalse();
        verify(results, Mockito.atLeastOnce()).save(e.result);
    }

    @Test
    void volverAResolverUnaRevisionRevisadaRecalculaConElNuevoPuntaje() {
        Escenario e = escenario(2);
        e.reviewerStubs();

        service.resolve(e.reviews.get(0).getId(), new ManualReviewService.ReviewCommand(new BigDecimal("4.50"), "ok", true));
        service.resolve(e.reviews.get(0).getId(), new ManualReviewService.ReviewCommand(new BigDecimal("2.00"), "ajuste", true));

        assertThat(e.result.getPuntajeTotalDirecto()).isEqualByComparingTo("2.00");
        assertThat(e.result.getCantidadPendientesRevision()).isEqualTo(1);
    }

    @Test
    void observarNoAplicaPuntajeYSigueContandoComoPendiente() {
        Escenario e = escenario(2);
        e.reviewerStubs();

        ManualReviewService.PendingReviewView view = service.resolve(e.reviews.get(0).getId(),
                new ManualReviewService.ReviewCommand(new BigDecimal("3.00"), "falta detalle", false));

        assertThat(view.status()).isEqualTo("OBSERVADO");
        assertThat(e.gradingList.get(0).getPuntajeObtenido()).isEqualByComparingTo("0");
        assertThat(e.gradingList.get(0).getRequiereRevisionManual()).isTrue();
        assertThat(e.result.getPuntajeTotalDirecto()).isEqualByComparingTo("0");
        assertThat(e.result.getCantidadPendientesRevision()).isEqualTo(2);
        assertThat(e.result.getRequiereRevisionManual()).isTrue();
    }

    @Test
    void observarUnaRevisionYaRevisadaRevierteElPuntajeAplicado() {
        Escenario e = escenario(2);
        e.reviewerStubs();

        service.resolve(e.reviews.get(0).getId(), new ManualReviewService.ReviewCommand(new BigDecimal("4.50"), "ok", true));
        service.resolve(e.reviews.get(0).getId(), new ManualReviewService.ReviewCommand(null, "revisar de nuevo", false));

        assertThat(e.result.getPuntajeTotalDirecto()).isEqualByComparingTo("0");
        assertThat(e.result.getCantidadPendientesRevision()).isEqualTo(2);
    }

    @Test
    void resolverSinResultadoDelIntentoResponde409() {
        Escenario e = escenario(1);
        e.reviewerStubs();
        when(results.findByIntentoId(33L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.resolve(e.reviews.get(0).getId(),
                new ManualReviewService.ReviewCommand(new BigDecimal("1"), "x", true)))
                .isInstanceOf(IllegalStateException.class);
        verify(reviews, never()).save(Mockito.any());
    }

    @Test
    void resolverValidaQueElPuntajeNoSeaNegativoNiSuperePuntajeDeLaClave() {
        Escenario e = escenario(1);
        e.reviewerStubs();

        assertThatThrownBy(() -> service.resolve(e.reviews.get(0).getId(),
                new ManualReviewService.ReviewCommand(new BigDecimal("-0.01"), "x", true)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.resolve(e.reviews.get(0).getId(),
                new ManualReviewService.ReviewCommand(new BigDecimal("5.01"), "x", true)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.resolve(e.reviews.get(0).getId(),
                new ManualReviewService.ReviewCommand(null, "x", true)))
                .isInstanceOf(IllegalArgumentException.class);
        verify(reviews, never()).save(Mockito.any());

        // el maximo exacto es valido
        service.resolve(e.reviews.get(0).getId(), new ManualReviewService.ReviewCommand(new BigDecimal("5.00"), "x", true));
        assertThat(e.result.getPuntajeTotalDirecto()).isEqualByComparingTo("5.00");
    }

    @Test
    void createPendingForAnswerEsIdempotente() {
        RespuestaItem answer = answerGraph(44L);
        RevisionManualRespuesta existing = new RevisionManualRespuesta();
        existing.setId(9L);
        existing.setRespuesta(answer);
        existing.setEstado(EstadoRevisionManual.REVISADO);
        existing.setCreadoEn(CLOCK.instant().atZone(ZoneOffset.UTC).toLocalDateTime());
        when(answers.findById(44L)).thenReturn(Optional.of(answer));
        when(reviews.findByRespuestaId(44L)).thenReturn(Optional.of(existing));

        assertThat(service.createPendingForAnswer(44L).status()).isEqualTo("REVISADO");
        verify(reviews, never()).save(Mockito.any());
    }

    /** Intento 33 con n respuestas de revision manual (puntaje maximo 5.00 cada una) y su resultado. */
    private Escenario escenario(int n) {
        Escenario e = new Escenario();
        e.result = new Resultado();
        e.result.setId(70L);
        e.result.setPuntajeTotalDirecto(BigDecimal.ZERO);
        e.result.setCantidadItems(n);
        e.result.setCantidadCorrectas(0);
        e.result.setCantidadIncorrectas(n);
        e.result.setCantidadPendientesRevision(n);
        e.result.setRequiereRevisionManual(true);
        e.dimension = new ResultadoDimension();
        e.dimension.setRequiereRevisionManual(true);
        ReglaCalificacion regla = new ReglaCalificacion();
        regla.setId(80L);
        for (int i = 0; i < n; i++) {
            RespuestaItem answer = answerGraph(44L + i);
            answer.getItem().setId(22L + i);
            e.result.setIntento(answer.getIntento());
            CalificacionRespuesta grading = new CalificacionRespuesta();
            grading.setRespuesta(answer);
            grading.setReglaCalificacion(regla);
            grading.setPuntajeObtenido(BigDecimal.ZERO);
            grading.setEsCorrecta(false);
            grading.setRequiereRevisionManual(true);
            e.gradingList.add(grading);
            RevisionManualRespuesta review = new RevisionManualRespuesta();
            review.setId(55L + i);
            review.setRespuesta(answer);
            review.setEstado(EstadoRevisionManual.PENDIENTE);
            review.setCreadoEn(CLOCK.instant().atZone(ZoneOffset.UTC).toLocalDateTime());
            e.reviews.add(review);
            when(reviews.findById(review.getId())).thenReturn(Optional.of(review));
            ClaveRespuesta clave = new ClaveRespuesta();
            clave.setPuntaje(new BigDecimal("5.00"));
            when(keys.findFirstByReglaCalificacionIdAndItemId(80L, answer.getItem().getId()))
                    .thenReturn(Optional.of(clave));
        }
        when(results.findByIntentoId(33L)).thenReturn(Optional.of(e.result));
        when(attempts.findByIdForUpdate(33L)).thenReturn(Optional.of(e.result.getIntento()));
        when(gradings.findByResultadoId(70L)).thenReturn(e.gradingList);
        when(reviews.findByRespuestaIntentoId(33L)).thenReturn(e.reviews);
        when(dimensionResults.findByResultadoId(70L)).thenReturn(List.of(e.dimension));
        return e;
    }

    private final class Escenario {
        final Usuario reviewer = new Usuario();
        final List<CalificacionRespuesta> gradingList = new java.util.ArrayList<>();
        final List<RevisionManualRespuesta> reviews = new java.util.ArrayList<>();
        Resultado result;
        ResultadoDimension dimension;

        void reviewerStubs() {
            UUID reviewerId = UUID.randomUUID();
            reviewer.setId(reviewerId);
            when(currentActor.usuarioId()).thenReturn(reviewerId);
            when(users.findById(reviewerId)).thenReturn(Optional.of(reviewer));
        }
    }

    @Test
    void pendingDevuelveRevisionesPendientesOrdenadasComoRepositorio() {
        RevisionManualRespuesta review = new RevisionManualRespuesta();
        review.setId(55L);
        review.setRespuesta(answerGraph(44L));
        review.setEstado(EstadoRevisionManual.PENDIENTE);
        review.setCreadoEn(CLOCK.instant().atZone(ZoneOffset.UTC).toLocalDateTime());
        when(reviews.findPendingWithAnswerContext(List.of(EstadoRevisionManual.PENDIENTE, EstadoRevisionManual.OBSERVADO)))
                .thenReturn(List.of(review));

        assertThat(service.pending()).singleElement().satisfies(view -> {
            assertThat(view.reviewId()).isEqualTo(55L);
            assertThat(view.answerId()).isEqualTo(44L);
            assertThat(view.participantName()).isEqualTo("Ana Lopez");
        });
        verify(reviews).findPendingWithAnswerContext(List.of(EstadoRevisionManual.PENDIENTE, EstadoRevisionManual.OBSERVADO));
        verify(reviews, never()).findByEstadoOrderByCreadoEnAsc(EstadoRevisionManual.PENDIENTE);
    }

    @Test
    void unaRevisionObservadaSigueEnLaBandejaConSuEstadoYAlAprobarlaSale() {
        Escenario e = escenario(1);
        e.reviewerStubs();
        // Repositorio en memoria: la bandeja filtra por los estados pedidos, como la consulta real.
        when(reviews.findPendingWithAnswerContext(Mockito.anyCollection())).thenAnswer(invocation -> {
            java.util.Collection<EstadoRevisionManual> estados = invocation.getArgument(0);
            return e.reviews.stream().filter(r -> estados.contains(r.getEstado())).toList();
        });
        assertThat(service.pending()).hasSize(1);

        service.resolve(e.reviews.get(0).getId(), new ManualReviewService.ReviewCommand(null, "falta detalle", false));

        assertThat(service.pending()).singleElement().satisfies(view -> assertThat(view.status()).isEqualTo("OBSERVADO"));
        assertThat(e.result.getRequiereRevisionManual()).isTrue();

        service.resolve(e.reviews.get(0).getId(), new ManualReviewService.ReviewCommand(new BigDecimal("3.00"), "ok", true));

        assertThat(service.pending()).isEmpty();
        assertThat(e.result.getRequiereRevisionManual()).isFalse();
    }

    private static RespuestaItem answerGraph(Long answerId) {
        Participante participant = new Participante();
        participant.setId(UUID.randomUUID());
        participant.setNombres("Ana");
        participant.setApellidos("Lopez");
        AsignacionTest assignment = new AsignacionTest();
        assignment.setParticipante(participant);
        IntentoTest attempt = new IntentoTest();
        attempt.setId(33L);
        attempt.setAsignacion(assignment);
        Item item = new Item();
        item.setId(22L);
        item.setCodigoItem("ITEM-22");
        item.setEnunciado("Pregunta abierta");
        RespuestaItem answer = new RespuestaItem();
        answer.setId(answerId);
        answer.setIntento(attempt);
        answer.setItem(item);
        answer.setRespuestaTextoAbierto("Respuesta");
        answer.setRespuestaNumerica(new BigDecimal("5"));
        answer.setRequiereRevisionManual(false);
        return answer;
    }
}
