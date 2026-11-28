package com.uam.psychoform.scoring;

import static org.assertj.core.api.Assertions.assertThat;

import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.scoring.model.Resultado;
import com.uam.psychoform.scoring.service.ScoringService;
import com.uam.psychoform.security.service.JwtService.JwtPrincipal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * R4: {@code scoreAttempt} adquiere primero el bloqueo del intento. Mientras otra transaccion lo retiene, la llamada
 * espera (no devuelve ni falla por conflicto) y, al liberarse, entrega el resultado ya creado sin duplicarlo.
 * Siembra minima con session_replication_role = replica (solo durante siembra y limpieza).
 */
@SpringBootTest
class ScoringConcurrencyIntegrationTest {
    private static final long ESPERA_BLOQUEO_MS = 700;

    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    PlatformTransactionManager txManager;
    @Autowired
    ScoringService scoring;
    @Autowired
    IntentoTestRepository intentos;

    private long sesionId;
    private long asignacionId;
    private long intentoId;
    private long resultadoId;

    private void sembrar() {
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            jdbc.execute("set local session_replication_role = replica");
            String sufijo = UUID.randomUUID().toString().substring(0, 8);
            sesionId = jdbc.queryForObject("insert into sesion_aplicacion (version_test_id, codigo_sesion, "
                    + "nombre_sesion, inicio_programado, estado) values (-1, ?, 'tmp', now(), 'ABIERTA') "
                    + "returning sesion_aplicacion_id", Long.class, "TEST-SCORE-" + sufijo);
            asignacionId = jdbc.queryForObject("insert into asignacion_test (sesion_aplicacion_id, participante_id, "
                    + "evaluador_id, token_acceso_hash, token_expira_en, estado) values (?, ?, ?, 'x', "
                    + "(now() at time zone 'utc') + interval '1 day', 'COMPLETADO') returning asignacion_id",
                    Long.class, sesionId, UUID.randomUUID(), UUID.randomUUID());
            intentoId = jdbc.queryForObject("insert into intento_test (asignacion_id, estado, iniciado_en, "
                    + "finalizado_en) values (?, 'COMPLETADO', now() at time zone 'utc', now() at time zone 'utc') "
                    + "returning intento_id", Long.class, asignacionId);
            resultadoId = jdbc.queryForObject("insert into resultado (intento_id) values (?) returning resultado_id",
                    Long.class, intentoId);
        });
    }

    @AfterEach
    void limpiar() {
        if (intentoId == 0) {
            return;
        }
        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            jdbc.execute("set local session_replication_role = replica");
            jdbc.update("delete from resultado where intento_id = ?", intentoId);
            jdbc.update("delete from intento_test where intento_id = ?", intentoId);
            jdbc.update("delete from asignacion_test where asignacion_id = ?", asignacionId);
            jdbc.update("delete from sesion_aplicacion where sesion_aplicacion_id = ?", sesionId);
        });
    }

    private Resultado scoreAsGrader() {
        JwtPrincipal principal = new JwtPrincipal(UUID.randomUUID(), "grader", Set.of("CALIFICACION_EJECUTAR"),
                Set.of(), Long.MAX_VALUE);
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(principal, null,
                List.of(new SimpleGrantedAuthority("PERM_CALIFICACION_EJECUTAR"))));
        try {
            return scoring.scoreAttempt(intentoId);
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    @Test
    void scoreAttemptEsperaElBloqueoDelIntentoYLuegoDevuelveElResultadoExistente() throws Exception {
        sembrar();
        CompletableFuture<Resultado>[] segunda = new CompletableFuture[1];

        new TransactionTemplate(txManager).executeWithoutResult(status -> {
            // Esta transaccion retiene el bloqueo del intento, como una calificacion en curso.
            intentos.findByIdForUpdate(intentoId).orElseThrow();
            segunda[0] = CompletableFuture.supplyAsync(this::scoreAsGrader);
            try {
                Thread.sleep(ESPERA_BLOQUEO_MS);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
            assertThat(segunda[0]).as("scoreAttempt debe esperar el bloqueo del intento").isNotDone();
        });

        assertThat(segunda[0].get(10, TimeUnit.SECONDS).getId()).isEqualTo(resultadoId);
        assertThat(jdbc.queryForObject("select count(*) from resultado where intento_id = ?", Long.class, intentoId))
                .isEqualTo(1L);
    }

    @Test
    void dosCalificacionesSimultaneasTerminanBienYDejanUnSoloResultado() throws Exception {
        sembrar();

        CompletableFuture<Resultado> a = CompletableFuture.supplyAsync(this::scoreAsGrader);
        CompletableFuture<Resultado> b = CompletableFuture.supplyAsync(this::scoreAsGrader);

        assertThat(a.get(10, TimeUnit.SECONDS).getId()).isEqualTo(resultadoId);
        assertThat(b.get(10, TimeUnit.SECONDS).getId()).isEqualTo(resultadoId);
        assertThat(jdbc.queryForObject("select count(*) from resultado where intento_id = ?", Long.class, intentoId))
                .isEqualTo(1L);
    }
}
