package com.uam.psychoform.instrument.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.uam.psychoform.instrument.model.EstadoVersionTest;
import com.uam.psychoform.instrument.model.EstrategiaCalificacion;
import com.uam.psychoform.instrument.model.ReglaCalificacion;
import com.uam.psychoform.instrument.model.Subtest;
import com.uam.psychoform.instrument.model.TipoReglaCalificacion;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.instrument.repository.VersionTestRepository;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

/** S1.12: {@code parametros} de una regla debe ser un objeto JSON valido. */
class InstrumentAdminServiceScoringRuleParametersTest {
    private final EntityManager em = Mockito.mock(EntityManager.class);
    private final VersionTestRepository versions = Mockito.mock(VersionTestRepository.class);
    private final UsuarioRepository users = Mockito.mock(UsuarioRepository.class);
    private final CurrentActor currentActor = Mockito.mock(CurrentActor.class);
    private final InstrumentAdminService service = new InstrumentAdminService(em, versions, users, currentActor,
            Clock.fixed(Instant.parse("2026-06-26T10:15:30Z"), ZoneOffset.UTC));

    @BeforeEach
    void stubs() {
        UUID actorId = UUID.randomUUID();
        Usuario actor = new Usuario();
        actor.setId(actorId);
        when(currentActor.usuarioId()).thenReturn(actorId);
        when(users.findById(actorId)).thenReturn(Optional.of(actor));
        VersionTest version = new VersionTest();
        version.setId(100L);
        version.setEstado(EstadoVersionTest.BORRADOR);
        when(versions.findByIdForUpdate(100L)).thenReturn(Optional.of(version));
        Subtest subtest = new Subtest();
        subtest.setId(5L);
        subtest.setVersionTest(version);
        when(em.find(Subtest.class, 5L)).thenReturn(subtest);
        EstrategiaCalificacion strategy = new EstrategiaCalificacion();
        when(em.find(EstrategiaCalificacion.class, (short) 1)).thenReturn(strategy);
        ReglaCalificacion existing = new ReglaCalificacion();
        existing.setVersionTest(version);
        when(em.find(ReglaCalificacion.class, 9L)).thenReturn(existing);
    }

    private InstrumentAdminService.ScoringRuleCommand command(String json) {
        return new InstrumentAdminService.ScoringRuleCommand((short) 1, TipoReglaCalificacion.CLAVE_ITEM, null, 1, json,
                null, null);
    }

    @Test
    void parametrosNuloSeGuardaComoObjetoVacio() {
        assertThat(service.createScoringRule(5L, command((String) null)).getParametros()).isEqualTo("{}");
        assertThat(service.updateScoringRule(9L, command((String) null)).getParametros()).isEqualTo("{}");
    }

    @Test
    void parametrosObjetoJsonValidoSeGuardaTalCual() {
        assertThat(service.createScoringRule(5L, command("{\"escala\": {\"min\": 1}}")).getParametros())
                .isEqualTo("{\"escala\": {\"min\": 1}}");
        assertThat(service.updateScoringRule(9L, command("{}")).getParametros()).isEqualTo("{}");
    }

    @Test
    void parametrosQueNoSonUnObjetoJsonValidoSeRechazanConMensajeEnEspanol() {
        for (String invalid : new String[] { "", "   ", "no es json", "[1,2]", "42", "\"texto\"", "null", "true",
                "{\"a\":", "{} basura" }) {
            assertThatThrownBy(() -> service.createScoringRule(5L, command(invalid)))
                    .as("create con %s", invalid)
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("parametros debe ser un objeto JSON valido");
            assertThatThrownBy(() -> service.updateScoringRule(9L, command(invalid)))
                    .as("update con %s", invalid)
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("parametros debe ser un objeto JSON valido");
        }
        verify(em, never()).persist(Mockito.any(ReglaCalificacion.class));
    }

    private InstrumentAdminService.ScoringRuleCommand commandActive(Boolean active) {
        return new InstrumentAdminService.ScoringRuleCommand((short) 1, TipoReglaCalificacion.CLAVE_ITEM, null, 1, null,
                null, active);
    }

    @Test
    void activaNulaCreaActivaYConservaElValorAlActualizar() {
        assertThat(service.createScoringRule(5L, commandActive(null)).getActiva()).isTrue();
        ReglaCalificacion inactiva = service.updateScoringRule(9L, commandActive(false));
        assertThat(inactiva.getActiva()).isFalse();
        // null conserva el valor actual (inactiva)
        assertThat(service.updateScoringRule(9L, commandActive(null)).getActiva()).isFalse();
        assertThat(service.updateScoringRule(9L, commandActive(true)).getActiva()).isTrue();
    }

    @Test
    void crearConActivaFalsaGuardaLaReglaInactiva() {
        assertThat(service.createScoringRule(5L, commandActive(false)).getActiva()).isFalse();
    }
}
