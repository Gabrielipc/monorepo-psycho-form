package com.uam.psychoform.scoring;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.instrument.InstrumentVersionFixture;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.instrument.repository.VersionTestRepository;
import com.uam.psychoform.scoring.model.CalificacionRespuesta;
import com.uam.psychoform.scoring.model.EstadoRevisionManual;
import com.uam.psychoform.scoring.model.Resultado;
import com.uam.psychoform.scoring.model.ResultadoDimension;
import com.uam.psychoform.scoring.model.RevisionManualRespuesta;
import com.uam.psychoform.scoring.repository.CalificacionRespuestaRepository;
import com.uam.psychoform.scoring.repository.ResultadoDimensionRepository;
import com.uam.psychoform.scoring.repository.ResultadoRepository;
import com.uam.psychoform.scoring.repository.RevisionManualRespuestaRepository;
import com.uam.psychoform.scoring.service.ResultRecalculator;
import com.uam.psychoform.scoring.service.ScoringContextLoader;
import com.uam.psychoform.scoring.service.ScoringResultWriter;
import com.uam.psychoform.scoring.service.ScoringStrategyCatalogSynchronizer;
import com.uam.psychoform.scoring.service.ScoringStrategyRegistry;
import com.uam.psychoform.scoring.service.strategy.ScoringConfiguration;
import com.uam.psychoform.scoring.service.strategy.ScoringContext;
import com.uam.psychoform.scoring.service.strategy.ScoringOutcome;
import com.uam.psychoform.scoring.service.strategy.ScoringStrategy;
import com.uam.psychoform.scoring.service.strategy.StrategyDescriptor;
import com.uam.psychoform.instrument.model.TipoEstrategiaCalificacion;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

/**
 * Integracion con la BD real (se revierte): el loader arma los snapshots con las consultas reales, CLAVE_SIMPLE
 * califica, el writer persiste pasando los triggers de alcance y el recalculador actualiza en sitio tras una revision.
 */
@SpringBootTest
@Transactional
class ScoringStrategiesIntegrationTest {
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    ScoringContextLoader loader;
    @Autowired
    ScoringStrategyRegistry registry;
    @Autowired
    ScoringResultWriter writer;
    @Autowired
    ResultRecalculator recalculator;
    @Autowired
    ScoringStrategyCatalogSynchronizer synchronizer;
    @Autowired
    IntentoTestRepository intentos;
    @Autowired
    VersionTestRepository versions;
    @Autowired
    UsuarioRepository usuarios;
    @Autowired
    ResultadoRepository resultados;
    @Autowired
    CalificacionRespuestaRepository calificaciones;
    @Autowired
    ResultadoDimensionRepository resultadosDimension;
    @Autowired
    RevisionManualRespuestaRepository revisiones;

    private record Seeded(long versionId, long attemptId, UUID actorId, long manualAnswerId) {
    }

    @Test
    void elCatalogoYaTieneLaEstrategiaImplementadaYLaSincronizacionEsIdempotente() {
        assertThat(registry.isImplemented("CLAVE_SIMPLE")).isTrue();
        assertThat(synchronizer.synchronize()).isZero();
        assertThat(jdbc.queryForObject("select count(*) from estrategia_calificacion where codigo = 'CLAVE_SIMPLE'",
                Long.class)).isEqualTo(1L);
    }

    @Test
    void unaEstrategiaNuevaSeRegistraEnElCatalogoSinModificarLasExistentes() {
        ScoringStrategy fake = new ScoringStrategy() {
            @Override
            public String code() {
                return "ZZ_TEST_ESTRATEGIA";
            }

            @Override
            public StrategyDescriptor descriptor() {
                return new StrategyDescriptor("ZZ_TEST_ESTRATEGIA", "Estrategia de prueba", "descripcion",
                        TipoEstrategiaCalificacion.FORMULA_CONTROLADA, true, false);
            }

            @Override
            public ScoringOutcome score(ScoringContext context) {
                return new ScoringOutcome(java.math.BigDecimal.ZERO, List.of(), List.of());
            }
        };
        ScoringStrategyCatalogSynchronizer sync = new ScoringStrategyCatalogSynchronizer(
                new ScoringStrategyRegistry(List.of(fake)), jdbc);

        assertThat(sync.synchronize()).isEqualTo(1);
        assertThat(sync.synchronize()).isZero();
        assertThat(jdbc.queryForMap("select nombre, tipo_estrategia::text as tipo, requiere_revision_manual as manual, "
                + "permite_baremo as baremo, activa from estrategia_calificacion where codigo = 'ZZ_TEST_ESTRATEGIA'"))
                .containsEntry("nombre", "Estrategia de prueba").containsEntry("tipo", "FORMULA_CONTROLADA")
                .containsEntry("manual", true).containsEntry("baremo", false).containsEntry("activa", true);
    }

    @Test
    void cargaLaConfiguracionDeLaVersionYValidaSuPublicacion() {
        Seeded seeded = seed();

        ScoringConfiguration configuration = loader.loadConfiguration(seeded.versionId());

        assertThat(configuration.strategyCode()).isEqualTo("CLAVE_SIMPLE");
        assertThat(configuration.subtests()).extracting(ScoringConfiguration.SubtestInfo::code).containsExactly("S1", "S2");
        assertThat(configuration.items()).extracting(ScoringConfiguration.ItemInfo::code)
                .containsExactly("I1", "I2", "I3", "I4", "I5");
        assertThat(configuration.keysByItem()).hasSize(5);
        assertThat(configuration.keysByItem().values().stream().filter(k -> !k.optionSetIds().isEmpty()).count())
                .isEqualTo(1L);
        assertThat(configuration.dimensions()).hasSize(1);
        assertThat(configuration.matrix()).hasSize(2);
        assertThat(configuration.rules()).isNotEmpty();
        assertThat(registry.find("CLAVE_SIMPLE").orElseThrow().validateConfiguration(configuration)).isEmpty();
    }

    @Test
    void unItemConDosClavesOficialesImpideCargarLaConfiguracion() {
        Seeded seeded = seed(true);

        assertThatThrownBy(() -> loader.loadConfiguration(seeded.versionId()))
                .isInstanceOf(IllegalStateException.class).hasMessage("El item I3 tiene mas de una clave de respuesta oficial");
    }

    @Test
    void calificaPersisteYRecalculaTrasUnaRevisionManual() {
        Seeded seeded = seed();
        IntentoTest intento = intentos.findById(seeded.attemptId()).orElseThrow();
        VersionTest version = versions.findById(seeded.versionId()).orElseThrow();
        Usuario actor = usuarios.findById(seeded.actorId()).orElseThrow();
        ScoringStrategy strategy = registry.require(version.getEstrategiaCalificacion());
        ScoringContext context = loader.load(intento);

        assertThat(context.attempt().profile().age()).isEqualTo(25);
        assertThat(context.attempt().answersByItem()).hasSize(5);
        ScoringOutcome outcome = strategy.score(context);
        Resultado resultado = writer.write(intento, version.getEstrategiaCalificacion(), actor, outcome, context);

        // I1 (2.00, matriz 1.5) + I2 (3.00) + I3 (1.00) + I4 (1.00) + I5 pendiente (0)
        assertThat(resultado.getPuntajeTotalDirecto()).isEqualByComparingTo("7.00");
        assertThat(resultado.getCantidadItems()).isEqualTo(5);
        assertThat(resultado.getCantidadCorrectas()).isEqualTo(4);
        assertThat(resultado.getCantidadPendientesRevision()).isEqualTo(1);
        assertThat(resultado.getRequiereRevisionManual()).isTrue();
        assertThat(calificaciones.findByResultadoId(resultado.getId())).hasSize(5);
        List<RevisionManualRespuesta> pending = revisiones.findByRespuestaIntentoId(seeded.attemptId());
        assertThat(pending).singleElement().satisfies(review -> {
            assertThat(review.getEstado()).isEqualTo(EstadoRevisionManual.PENDIENTE);
            assertThat(review.getRespuesta().getId()).isEqualTo(seeded.manualAnswerId());
        });
        // DIM-1 (subtest S1): matriz de I1 (1.5) + I2 sin matriz suma su puntaje (3.00) = 4.50 -> BAJO (0-5, edad 25)
        List<ResultadoDimension> dimensions = resultadosDimension.findByResultadoId(resultado.getId());
        assertThat(dimensions).singleElement().satisfies(row -> {
            assertThat(row.getPuntajeDirecto()).isEqualByComparingTo("4.50");
            assertThat(row.getCategoria()).isEqualTo("BAJO");
            assertThat(row.getBaremo()).isNotNull();
            assertThat(row.getRangoBaremo()).isNotNull();
            assertThat(row.getPuntajeTransformado()).isNull();
        });
        long dimensionRowId = dimensions.getFirst().getId();
        long gradingId = calificaciones.findByResultadoId(resultado.getId()).getFirst().getId();

        // La revision manual se resuelve y el resultado se recalcula en sitio.
        RevisionManualRespuesta review = pending.getFirst();
        review.setEstado(EstadoRevisionManual.REVISADO);
        review.setPuntajeAsignado(new java.math.BigDecimal("1.00"));
        review.setRevisadoPor(actor);
        review.setRevisadoEn(LocalDateTime.now());
        revisiones.saveAndFlush(review);
        recalculator.recalculate(resultado);

        Resultado recalculated = resultados.findByIntentoId(seeded.attemptId()).orElseThrow();
        assertThat(recalculated.getId()).isEqualTo(resultado.getId());
        assertThat(recalculated.getPuntajeTotalDirecto()).isEqualByComparingTo("8.00");
        assertThat(recalculated.getCantidadPendientesRevision()).isZero();
        assertThat(recalculated.getRequiereRevisionManual()).isFalse();
        assertThat(recalculated.getCantidadCorrectas()).isEqualTo(5);
        List<CalificacionRespuesta> gradings = calificaciones.findByResultadoId(resultado.getId());
        assertThat(gradings).hasSize(5);
        assertThat(gradings.stream().filter(g -> g.getId() == gradingId)).hasSize(1);
        assertThat(resultadosDimension.findByResultadoId(resultado.getId())).singleElement()
                .satisfies(row -> assertThat(row.getId()).isEqualTo(dimensionRowId));
    }

    // ---- datos ----

    private Seeded seed() {
        return seed(false);
    }

    private Seeded seed(boolean duplicateKeyOnI3) {
        UUID actorId = InstrumentVersionFixture.createUser(jdbc, "scoring-actor");
        long testId = InstrumentVersionFixture.createTest(jdbc, "scoring");
        long versionId = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "1.0");
        InstrumentVersionFixture.seedFullContent(jdbc, versionId);
        if (duplicateKeyOnI3) {
            long versionRule = jdbc.queryForObject("select regla_calificacion_id from regla_calificacion "
                    + "where version_test_id = ? and subtest_id is null", Long.class, versionId);
            jdbc.update("insert into clave_respuesta (regla_calificacion_id, item_id, texto_esperado, puntaje, "
                    + "requiere_revision_manual) values (?, ?, 'otra respuesta', 1, false)", versionRule,
                    itemId(versionId, "I3"));
        }
        jdbc.update("update regla_calificacion set estado = 'PUBLICADO', aprobado_por = ?, aprobado_en = now() "
                + "where version_test_id = ?", actorId, versionId);
        jdbc.update("update baremo set estado = 'PUBLICADO', aprobado_por = ?, aprobado_en = now() "
                + "where version_test_id = ?", actorId, versionId);
        InstrumentVersionFixture.publish(jdbc, versionId, actorId);

        String suffix = UUID.randomUUID().toString().substring(0, 8);
        long sessionId = jdbc.queryForObject(
                "insert into sesion_aplicacion (version_test_id, codigo_sesion, nombre_sesion, inicio_programado) "
                        + "values (?, ?, 'Sesion scoring', ?) returning sesion_aplicacion_id", Long.class, versionId,
                "SC-" + suffix, Timestamp.valueOf(LocalDateTime.of(2026, 11, 26, 8, 0)));
        List<Long> subtestIds = jdbc.queryForList(
                "select subtest_id from subtest where version_test_id = ? order by numero_orden", Long.class, versionId);
        int order = 1;
        for (long subtestId : subtestIds) {
            jdbc.update("insert into sesion_subtest (sesion_aplicacion_id, version_test_id, subtest_id, numero_orden) "
                    + "values (?, ?, ?, ?)", sessionId, versionId, subtestId, order++);
        }
        UUID participantId = UUID.randomUUID();
        jdbc.update("insert into participante (participante_id, codigo_participante, nombres, apellidos) "
                + "values (?, ?, 'Ana', 'Lopez')", participantId, "P-" + suffix);
        long assignmentId = jdbc.queryForObject(
                "insert into asignacion_test (sesion_aplicacion_id, participante_id, evaluador_id, token_acceso_hash, "
                        + "token_expira_en, estado, edad_registrada_aplicacion) "
                        + "values (?, ?, ?, ?, ?, cast('COMPLETADO' as estado_asignacion), 25) returning asignacion_id",
                Long.class, sessionId, participantId, actorId, "TOK-" + suffix,
                Timestamp.valueOf(LocalDateTime.of(2026, 12, 1, 0, 0)));
        long attemptId = jdbc.queryForObject(
                "insert into intento_test (asignacion_id, iniciado_en, finalizado_en, estado, tiempo_total_segundos) "
                        + "values (?, ?, ?, cast('COMPLETADO' as estado_intento), 600) returning intento_id", Long.class,
                assignmentId, Timestamp.valueOf(LocalDateTime.of(2026, 11, 26, 9, 0)),
                Timestamp.valueOf(LocalDateTime.of(2026, 11, 26, 9, 10)));

        long i1 = itemId(versionId, "I1");
        long i2 = itemId(versionId, "I2");
        long i3 = itemId(versionId, "I3");
        long i4 = itemId(versionId, "I4");
        long i5 = itemId(versionId, "I5");
        answerWithOptions(attemptId, i1, optionId(i1, "A"));
        answerWithOptions(attemptId, i2, optionId(i2, "A"), optionId(i2, "C"));
        long a3 = answer(attemptId, i3, "  respuesta   ESPERADA ", null);
        long a4 = answer(attemptId, i4, null, "3.9");
        long manual = answerWithOptions(attemptId, i5, optionId(i5, "A"));
        assertThat(a3).isNotEqualTo(a4);
        return new Seeded(versionId, attemptId, actorId, manual);
    }

    private long itemId(long versionId, String code) {
        return jdbc.queryForObject("select i.item_id from item i join subtest s on s.subtest_id = i.subtest_id "
                + "where s.version_test_id = ? and i.codigo_item = ?", Long.class, versionId, code);
    }

    private long optionId(long itemId, String code) {
        return jdbc.queryForObject("select opcion_id from opcion_item where item_id = ? and codigo_opcion = ?",
                Long.class, itemId, code);
    }

    private long answer(long attemptId, long itemId, String text, String number) {
        return jdbc.queryForObject("insert into respuesta_item (intento_id, item_id, respuesta_texto_abierto, "
                + "respuesta_numerica) values (?, ?, ?, ?::numeric) returning respuesta_id", Long.class, attemptId,
                itemId, text, number);
    }

    private long answerWithOptions(long attemptId, long itemId, long... optionIds) {
        long answerId = answer(attemptId, itemId, null, null);
        for (long optionId : optionIds) {
            jdbc.update("insert into opcion_seleccionada_respuesta (respuesta_id, item_id, opcion_id) values (?, ?, ?)",
                    answerId, itemId, optionId);
        }
        return answerId;
    }
}
