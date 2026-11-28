package com.uam.psychoform.instrument.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.uam.psychoform.instrument.model.EstadoVersionTest;
import com.uam.psychoform.instrument.model.EstrategiaCalificacion;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.instrument.repository.BaremoPublicationRepository;
import com.uam.psychoform.instrument.repository.ReglaCalificacionPublicationRepository;
import com.uam.psychoform.instrument.repository.VersionTestRepository;
import com.uam.psychoform.scoring.service.ScoringContextLoader;
import com.uam.psychoform.scoring.service.ScoringStrategyRegistry;
import com.uam.psychoform.scoring.service.strategy.ScoringConfiguration;
import com.uam.psychoform.scoring.service.strategy.ScoringContext;
import com.uam.psychoform.scoring.service.strategy.ScoringOutcome;
import com.uam.psychoform.scoring.service.strategy.ScoringStrategy;
import com.uam.psychoform.scoring.service.strategy.StrategyDescriptor;
import com.uam.psychoform.instrument.model.TipoEstrategiaCalificacion;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import java.lang.reflect.Method;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.mockito.InOrder;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;

class VersionTestServiceTest {
    @Test
    void rechazaModificarUnaVersionQueNoEstaEnBorrador() {
        VersionTestRepository repository = Mockito.mock(VersionTestRepository.class);
        VersionTest version = new VersionTest();
        version.setEstado(EstadoVersionTest.APROBADO);
        when(repository.findByIdForUpdate(5L)).thenReturn(Optional.of(version));
        VersionTestService service = new VersionTestService(repository);

        assertThatThrownBy(() -> service.exigirBorrador(5L))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aprobarVersionRequierePermisoTestPublicarYUsaActorActual() throws Exception {
        Escenario e = escenarioAprobacion(registry(fake("FAKE", List.of())), "FAKE", EstadoVersionTest.EN_REVISION,
                configuracion(true));

        Method method = VersionTestService.class.getMethod("approveVersion", long.class);

        assertThat(method.getAnnotation(PreAuthorize.class).value()).isEqualTo("hasAuthority('PERM_TEST_PUBLICAR')");
        assertThat(e.service.approveVersion(13L).getAprobadoPor()).isNotNull();
        assertThat(e.version.getEstado()).isEqualTo(EstadoVersionTest.APROBADO);
        Mockito.verify(e.loader).loadConfiguration(13L, ScoringContextLoader.ConfigurationScope.PUBLICATION_CANDIDATE);
    }

    @Test
    void aprobarVersionConProblemasDeConfiguracionResponde409YNoCambiaDeEstado() {
        Escenario e = escenarioAprobacion(registry(fake("FAKE",
                List.of("Subtest FI: el item FI-03 no tiene clave de respuesta", "Otro problema"))), "FAKE",
                EstadoVersionTest.BORRADOR, configuracion(true));

        assertThatThrownBy(() -> e.service.approveVersion(13L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("La version no se puede aprobar: Subtest FI: el item FI-03 no tiene clave de respuesta; "
                        + "Otro problema");

        assertThat(e.version.getEstado()).isEqualTo(EstadoVersionTest.BORRADOR);
        Mockito.verify(e.repository, Mockito.never()).save(e.version);
    }

    @Test
    void aprobarVersionSinReglasActivasResponde409() {
        Escenario e = escenarioAprobacion(registry(fake("FAKE", List.of())), "FAKE", EstadoVersionTest.BORRADOR,
                configuracion(false));

        assertThatThrownBy(() -> e.service.approveVersion(13L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("reglas de calificación activas");
        assertThat(e.version.getEstado()).isEqualTo(EstadoVersionTest.BORRADOR);
    }

    @Test
    void aprobarVersionSinImplementacionDeLaEstrategiaResponde409() {
        Escenario e = escenarioAprobacion(registry(fake("FAKE", List.of())), "OTRA", EstadoVersionTest.BORRADOR,
                configuracion(true));

        assertThatThrownBy(() -> e.service.approveVersion(13L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("La estrategia OTRA no tiene implementacion registrada");
        assertThat(e.version.getEstado()).isEqualTo(EstadoVersionTest.BORRADOR);
    }

    @Test
    void aprobarVersionConClaveDuplicadaPropagaElError() {
        Escenario e = escenarioAprobacion(registry(fake("FAKE", List.of())), "FAKE", EstadoVersionTest.BORRADOR,
                configuracion(true));
        when(e.loader.loadConfiguration(13L, ScoringContextLoader.ConfigurationScope.PUBLICATION_CANDIDATE))
                .thenThrow(new IllegalStateException("El item FI-01 tiene mas de una clave de respuesta oficial"));

        assertThatThrownBy(() -> e.service.approveVersion(13L))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("mas de una clave");
        assertThat(e.version.getEstado()).isEqualTo(EstadoVersionTest.BORRADOR);
    }

    @Test
    void devolverABorradorSoloDesdeAprobadoYLimpiaLaAprobacion() throws Exception {
        Escenario e = escenarioAprobacion(registry(fake("FAKE", List.of())), "FAKE", EstadoVersionTest.APROBADO,
                configuracion(true));
        e.version.setAprobadoPor(new Usuario());
        e.version.setAprobadoEn(LocalDateTime.now());

        Method method = VersionTestService.class.getMethod("returnToDraft", long.class);
        VersionTest result = e.service.returnToDraft(13L);

        assertThat(method.getAnnotation(PreAuthorize.class).value()).isEqualTo("hasAuthority('PERM_TEST_PUBLICAR')");
        assertThat(method.getAnnotation(Transactional.class)).isNotNull();
        assertThat(result.getEstado()).isEqualTo(EstadoVersionTest.BORRADOR);
        assertThat(result.getAprobadoPor()).isNull();
        assertThat(result.getAprobadoEn()).isNull();
        Mockito.verify(e.repository).save(e.version);
    }

    @Test
    void devolverABorradorRechazaCualquierOtroEstado() {
        for (EstadoVersionTest estado : List.of(EstadoVersionTest.BORRADOR, EstadoVersionTest.EN_REVISION,
                EstadoVersionTest.PUBLICADO, EstadoVersionTest.RETIRADO)) {
            Escenario e = escenarioAprobacion(registry(fake("FAKE", List.of())), "FAKE", estado, configuracion(true));

            assertThatThrownBy(() -> e.service.returnToDraft(13L)).isInstanceOf(IllegalStateException.class);
            assertThat(e.version.getEstado()).isEqualTo(estado);
        }
    }

    private static ScoringConfiguration configuracion(boolean conReglas) {
        ScoringConfiguration.RuleInfo rule = new ScoringConfiguration.RuleInfo(1L, null, null,
                com.uam.psychoform.instrument.model.TipoReglaCalificacion.CLAVE_ITEM, 1, null);
        return new ScoringConfiguration(13L, "FAKE", List.of(), List.of(), conReglas ? List.of(rule) : List.of(),
                java.util.Map.of(), List.of(), List.of());
    }

    private Escenario escenarioAprobacion(ScoringStrategyRegistry registry, String strategyCode,
            EstadoVersionTest estado, ScoringConfiguration configuration) {
        Escenario e = escenarioPublicacion(registry, strategyCode);
        e.version.setEstado(estado);
        when(e.loader.loadConfiguration(13L, ScoringContextLoader.ConfigurationScope.PUBLICATION_CANDIDATE))
                .thenReturn(configuration);
        return e;
    }

    @Test
    void publicarVersionPublicaReglasYBaremosActivosEnLaMismaTransaccion() throws Exception {
        VersionTestRepository repository = Mockito.mock(VersionTestRepository.class);
        UsuarioRepository usuarios = Mockito.mock(UsuarioRepository.class);
        CurrentActor currentActor = Mockito.mock(CurrentActor.class);
        ReglaCalificacionPublicationRepository reglas = Mockito.mock(ReglaCalificacionPublicationRepository.class);
        BaremoPublicationRepository baremos = Mockito.mock(BaremoPublicationRepository.class);
        UUID actorId = UUID.randomUUID();
        Usuario actor = new Usuario();
        actor.setId(actorId);
        Clock clock = Clock.fixed(Instant.parse("2026-07-01T20:30:00Z"), ZoneOffset.UTC);
        LocalDateTime approvedAt = LocalDateTime.now(clock);
        VersionTest version = new VersionTest();
        version.setId(11L);
        version.setEstado(EstadoVersionTest.APROBADO);
        version.setEstrategiaCalificacion(estrategia("FAKE"));
        when(repository.findByIdForUpdate(11L)).thenReturn(Optional.of(version));
        when(currentActor.usuarioId()).thenReturn(actorId);
        when(usuarios.findById(actorId)).thenReturn(Optional.of(actor));
        when(reglas.publishActiveByVersionId(11L, actor, approvedAt)).thenReturn(3);
        when(baremos.publishActiveByVersionId(11L, actor, approvedAt)).thenReturn(2);
        ScoringContextLoader loader = Mockito.mock(ScoringContextLoader.class);
        ScoringConfiguration configuration = Mockito.mock(ScoringConfiguration.class);
        when(loader.loadConfiguration(11L)).thenReturn(configuration);
        VersionTestService service = new VersionTestService(repository, usuarios, currentActor, clock,
                reglas, baremos, registry(fake("FAKE", List.of())), loader);

        Method method = VersionTestService.class.getMethod("publishVersion", long.class);
        VersionTest published = service.publishVersion(11L);

        assertThat(method.getAnnotation(Transactional.class)).isNotNull();
        assertThat(published.getEstado()).isEqualTo(EstadoVersionTest.PUBLICADO);
        InOrder inOrder = Mockito.inOrder(reglas, baremos, loader, repository);
        inOrder.verify(reglas).publishActiveByVersionId(11L, actor, approvedAt);
        inOrder.verify(baremos).publishActiveByVersionId(11L, actor, approvedAt);
        inOrder.verify(loader).loadConfiguration(11L);
        inOrder.verify(repository).save(version);
    }

    @Test
    void publicarVersionRechazaConfiguracionSinReglasActivas() {
        VersionTestRepository repository = Mockito.mock(VersionTestRepository.class);
        UsuarioRepository usuarios = Mockito.mock(UsuarioRepository.class);
        CurrentActor currentActor = Mockito.mock(CurrentActor.class);
        ReglaCalificacionPublicationRepository reglas = Mockito.mock(ReglaCalificacionPublicationRepository.class);
        BaremoPublicationRepository baremos = Mockito.mock(BaremoPublicationRepository.class);
        UUID actorId = UUID.randomUUID();
        Usuario actor = new Usuario();
        actor.setId(actorId);
        VersionTest version = new VersionTest();
        version.setId(12L);
        version.setEstado(EstadoVersionTest.APROBADO);
        version.setEstrategiaCalificacion(estrategia("FAKE"));
        when(repository.findByIdForUpdate(12L)).thenReturn(Optional.of(version));
        when(currentActor.usuarioId()).thenReturn(actorId);
        when(usuarios.findById(actorId)).thenReturn(Optional.of(actor));
        when(reglas.publishActiveByVersionId(Mockito.eq(12L), Mockito.eq(actor), Mockito.any(LocalDateTime.class)))
                .thenReturn(0);
        VersionTestService service = new VersionTestService(repository, usuarios, currentActor, java.time.Clock.systemUTC(),
                reglas, baremos, registry(fake("FAKE", List.of())), Mockito.mock(ScoringContextLoader.class));

        assertThatThrownBy(() -> service.publishVersion(12L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("reglas de calificación activas");

        assertThat(version.getEstado()).isEqualTo(EstadoVersionTest.APROBADO);
        Mockito.verifyNoInteractions(baremos);
        Mockito.verify(repository, Mockito.never()).save(version);
    }

    @Test
    void publicarVersionSinImplementacionDeLaEstrategiaResponde409YNoPublica() {
        Escenario e = escenarioPublicacion(registry(fake("FAKE", List.of())), "OTRA");

        assertThatThrownBy(() -> e.service.publishVersion(13L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("La estrategia OTRA no tiene implementacion registrada");

        assertThat(e.version.getEstado()).isEqualTo(EstadoVersionTest.APROBADO);
        Mockito.verifyNoInteractions(e.loader);
        Mockito.verify(e.repository, Mockito.never()).save(e.version);
    }

    @Test
    void publicarVersionConProblemasDeConfiguracionResponde409ConElDetalle() {
        Escenario e = escenarioPublicacion(registry(fake("FAKE",
                List.of("Subtest FI: el item FI-03 no tiene clave de respuesta", "Otro problema"))), "FAKE");

        assertThatThrownBy(() -> e.service.publishVersion(13L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("La version no se puede publicar: Subtest FI: el item FI-03 no tiene clave de respuesta; "
                        + "Otro problema");

        assertThat(e.version.getEstado()).isEqualTo(EstadoVersionTest.APROBADO);
        Mockito.verify(e.repository, Mockito.never()).save(e.version);
    }

    @Test
    void publicarVersionFallaSiUnItemTieneClaveDuplicada() {
        Escenario e = escenarioPublicacion(registry(fake("FAKE", List.of())), "FAKE");
        when(e.loader.loadConfiguration(13L)).thenThrow(
                new IllegalStateException("El item FI-01 tiene mas de una clave de respuesta oficial"));

        assertThatThrownBy(() -> e.service.publishVersion(13L))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("mas de una clave");
        assertThat(e.version.getEstado()).isEqualTo(EstadoVersionTest.APROBADO);
    }

    @Test
    void publicarVersionCorrectaValidaDespuesDePromoverReglasYAntesDeMarcarPublicado() {
        Escenario e = escenarioPublicacion(registry(fake("FAKE", List.of())), "FAKE");

        assertThat(e.service.publishVersion(13L).getEstado()).isEqualTo(EstadoVersionTest.PUBLICADO);
        InOrder order = Mockito.inOrder(e.reglas, e.baremos, e.loader, e.repository);
        order.verify(e.reglas).publishActiveByVersionId(Mockito.eq(13L), Mockito.any(), Mockito.any());
        order.verify(e.baremos).publishActiveByVersionId(Mockito.eq(13L), Mockito.any(), Mockito.any());
        order.verify(e.loader).loadConfiguration(13L);
        order.verify(e.repository).save(e.version);
    }

    private record Escenario(VersionTestService service, VersionTest version, VersionTestRepository repository,
            ReglaCalificacionPublicationRepository reglas, BaremoPublicationRepository baremos,
            ScoringContextLoader loader) {
    }

    private Escenario escenarioPublicacion(ScoringStrategyRegistry registry, String strategyCode) {
        VersionTestRepository repository = Mockito.mock(VersionTestRepository.class);
        UsuarioRepository usuarios = Mockito.mock(UsuarioRepository.class);
        CurrentActor currentActor = Mockito.mock(CurrentActor.class);
        ReglaCalificacionPublicationRepository reglas = Mockito.mock(ReglaCalificacionPublicationRepository.class);
        BaremoPublicationRepository baremos = Mockito.mock(BaremoPublicationRepository.class);
        ScoringContextLoader loader = Mockito.mock(ScoringContextLoader.class);
        UUID actorId = UUID.randomUUID();
        Usuario actor = new Usuario();
        actor.setId(actorId);
        VersionTest version = new VersionTest();
        version.setId(13L);
        version.setEstado(EstadoVersionTest.APROBADO);
        version.setEstrategiaCalificacion(estrategia(strategyCode));
        when(repository.findByIdForUpdate(13L)).thenReturn(Optional.of(version));
        when(currentActor.usuarioId()).thenReturn(actorId);
        when(usuarios.findById(actorId)).thenReturn(Optional.of(actor));
        when(reglas.publishActiveByVersionId(Mockito.eq(13L), Mockito.eq(actor), Mockito.any(LocalDateTime.class)))
                .thenReturn(2);
        when(loader.loadConfiguration(13L)).thenReturn(Mockito.mock(ScoringConfiguration.class));
        VersionTestService service = new VersionTestService(repository, usuarios, currentActor, Clock.systemUTC(),
                reglas, baremos, registry, loader);
        return new Escenario(service, version, repository, reglas, baremos, loader);
    }

    private static EstrategiaCalificacion estrategia(String code) {
        EstrategiaCalificacion estrategia = new EstrategiaCalificacion();
        estrategia.setCodigo(code);
        return estrategia;
    }

    private static ScoringStrategyRegistry registry(ScoringStrategy... strategies) {
        return new ScoringStrategyRegistry(List.of(strategies));
    }

    private static ScoringStrategy fake(String code, List<String> problems) {
        return new ScoringStrategy() {
            @Override
            public String code() {
                return code;
            }

            @Override
            public StrategyDescriptor descriptor() {
                return new StrategyDescriptor(code, code, null, TipoEstrategiaCalificacion.FORMULA_CONTROLADA, false,
                        false);
            }

            @Override
            public List<String> validateConfiguration(ScoringConfiguration configuration) {
                return problems;
            }

            @Override
            public ScoringOutcome score(ScoringContext context) {
                return new ScoringOutcome(BigDecimal.ZERO, List.of(), List.of());
            }
        };
    }
}
