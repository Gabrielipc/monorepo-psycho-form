package com.uam.psychoform.instrument.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.uam.psychoform.academic.model.Carrera;
import com.uam.psychoform.academic.model.CatalogoSexo;
import com.uam.psychoform.instrument.model.*;
import com.uam.psychoform.instrument.repository.VersionTestRepository;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class InstrumentAdminServiceBaremoCriteriaTest {
    private static final UUID ACTOR = UUID.fromString("44444444-4444-4444-4444-444444444444");
    private final EntityManager em = Mockito.mock(EntityManager.class);
    private final VersionTestRepository versions = Mockito.mock(VersionTestRepository.class);
    private final UsuarioRepository users = Mockito.mock(UsuarioRepository.class);
    private final CurrentActor currentActor = Mockito.mock(CurrentActor.class);
    private final InstrumentAdminService service = new InstrumentAdminService(em, versions, users, currentActor,
            Clock.fixed(Instant.parse("2026-06-26T10:15:30Z"), ZoneOffset.UTC));
    private final CatalogoSexo sex = new CatalogoSexo();
    private final Carrera career = new Carrera();

    @BeforeEach
    void setUp() {
        VersionTest draft = new VersionTest();
        draft.setId(1L);
        draft.setEstado(EstadoVersionTest.BORRADOR);
        when(versions.findByIdForUpdate(1L)).thenReturn(Optional.of(draft));
        when(currentActor.usuarioId()).thenReturn(ACTOR);
        when(users.findById(ACTOR)).thenReturn(Optional.of(new Usuario()));
        sex.setId((short) 1);
        career.setId((short) 2);
        when(em.find(CatalogoSexo.class, (short) 1)).thenReturn(sex);
        when(em.find(Carrera.class, (short) 2)).thenReturn(career);
    }

    private static InstrumentAdminService.BaremoCommand command(Short min, Short max, Short sexId, Short careerId,
            LocalDate from, LocalDate to, Boolean clear) {
        return new InstrumentAdminService.BaremoCommand(1L, null, "B", "Baremo", null, null, min, max, sexId,
                careerId, from, to, clear);
    }

    private Baremo existing() {
        VersionTest version = new VersionTest();
        version.setId(1L);
        Baremo baremo = new Baremo();
        baremo.setId(9L);
        baremo.setVersionTest(version);
        baremo.setCriterioEdadMinima((short) 18);
        baremo.setCriterioEdadMaxima((short) 30);
        baremo.setCriterioSexo(sex);
        baremo.setCriterioCarrera(career);
        baremo.setVigenteDesde(LocalDate.of(2026, 1, 1));
        baremo.setVigenteHasta(LocalDate.of(2026, 12, 31));
        when(em.find(Baremo.class, 9L)).thenReturn(baremo);
        return baremo;
    }

    @Test
    void createAppliesCriteria() {
        service.createBaremo(command((short) 18, (short) 30, (short) 1, (short) 2, LocalDate.of(2026, 1, 1),
                LocalDate.of(2026, 12, 31), null));

        ArgumentCaptor<Baremo> captor = ArgumentCaptor.forClass(Baremo.class);
        Mockito.verify(em).persist(captor.capture());
        Baremo saved = captor.getValue();
        assertThat(saved.getCriterioEdadMinima()).isEqualTo((short) 18);
        assertThat(saved.getCriterioEdadMaxima()).isEqualTo((short) 30);
        assertThat(saved.getCriterioSexo()).isSameAs(sex);
        assertThat(saved.getCriterioCarrera()).isSameAs(career);
        assertThat(saved.getVigenteDesde()).isEqualTo(LocalDate.of(2026, 1, 1));
        assertThat(saved.getVigenteHasta()).isEqualTo(LocalDate.of(2026, 12, 31));
    }

    @Test
    void createWithoutCriteriaLeavesThemNull() {
        service.createBaremo(command(null, null, null, null, null, null, null));

        ArgumentCaptor<Baremo> captor = ArgumentCaptor.forClass(Baremo.class);
        Mockito.verify(em).persist(captor.capture());
        assertThat(captor.getValue().getCriterioEdadMinima()).isNull();
        assertThat(captor.getValue().getCriterioSexo()).isNull();
        assertThat(captor.getValue().getVigenteHasta()).isNull();
    }

    @Test
    void updateWithNullsKeepsCurrentCriteria() {
        Baremo baremo = existing();

        service.updateBaremo(9L, command(null, null, null, null, null, null, null));

        assertThat(baremo.getNombre()).isEqualTo("Baremo");
        assertThat(baremo.getCriterioEdadMinima()).isEqualTo((short) 18);
        assertThat(baremo.getCriterioEdadMaxima()).isEqualTo((short) 30);
        assertThat(baremo.getCriterioSexo()).isSameAs(sex);
        assertThat(baremo.getCriterioCarrera()).isSameAs(career);
        assertThat(baremo.getVigenteDesde()).isEqualTo(LocalDate.of(2026, 1, 1));
        assertThat(baremo.getVigenteHasta()).isEqualTo(LocalDate.of(2026, 12, 31));
    }

    @Test
    void updateWithClearThenAppliesNonNullValues() {
        Baremo baremo = existing();

        service.updateBaremo(9L, command((short) 40, null, null, null, null, null, true));

        assertThat(baremo.getCriterioEdadMinima()).isEqualTo((short) 40);
        assertThat(baremo.getCriterioEdadMaxima()).isNull();
        assertThat(baremo.getCriterioSexo()).isNull();
        assertThat(baremo.getCriterioCarrera()).isNull();
        assertThat(baremo.getVigenteDesde()).isNull();
        assertThat(baremo.getVigenteHasta()).isNull();
    }

    @Test
    void updateWithOnlyClearRemovesAllCriteria() {
        Baremo baremo = existing();

        service.updateBaremo(9L, command(null, null, null, null, null, null, true));

        assertThat(baremo.getCriterioEdadMinima()).isNull();
        assertThat(baremo.getCriterioCarrera()).isNull();
        assertThat(baremo.getVigenteDesde()).isNull();
    }

    @Test
    void rejectsInvertedAge() {
        assertThatThrownBy(() -> service.createBaremo(command((short) 40, (short) 20, null, null, null, null, null)))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("edad minima");
    }

    @Test
    void updateRejectsAgeInvertedAgainstCurrentValue() {
        existing();

        assertThatThrownBy(() -> service.updateBaremo(9L, command((short) 50, null, null, null, null, null, null)))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("edad minima");
    }

    @Test
    void rejectsInvertedValidity() {
        assertThatThrownBy(() -> service.createBaremo(command(null, null, null, null, LocalDate.of(2026, 12, 1),
                LocalDate.of(2026, 1, 1), null)))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("vigencia");
    }

    @Test
    void rejectsUnknownSexAndCareer() {
        assertThatThrownBy(() -> service.createBaremo(command(null, null, (short) 99, null, null, null, null)))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("sexo");
        assertThatThrownBy(() -> service.createBaremo(command(null, null, null, (short) 99, null, null, null)))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("carrera");
    }

    @Test
    void createRequiresDraftVersion() {
        VersionTest published = new VersionTest();
        published.setId(1L);
        published.setEstado(EstadoVersionTest.PUBLICADO);
        when(versions.findByIdForUpdate(1L)).thenReturn(Optional.of(published));

        assertThatThrownBy(() -> service.createBaremo(command(null, null, null, null, null, null, null)))
                .isInstanceOf(IllegalStateException.class);
    }
}
