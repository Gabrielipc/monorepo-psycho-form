package com.uam.psychoform.instrument;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.security.service.JwtService;
import jakarta.persistence.EntityManager;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** Dimensiones y matriz opcion-dimension contra la BD real (triggers e indice unico incluidos); transaccional. */
@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
@Transactional
class ScoringDimensionIntegrationTest {
    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    EntityManager em;

    private UUID creatorId;
    private long versionId;
    private long ruleS1;
    private long ruleS2;
    private long dimension1;
    private List<Long> optionsS1;
    private List<Long> optionsS2;

    @BeforeEach
    void seed() {
        creatorId = InstrumentVersionFixture.createUser(jdbc, "dim");
        long testId = InstrumentVersionFixture.createTest(jdbc, "DIM");
        versionId = InstrumentVersionFixture.createDraftVersion(jdbc, testId, "1.0");
        InstrumentVersionFixture.seedFullContent(jdbc, versionId);
        ruleS1 = ruleOf("S1");
        ruleS2 = ruleOf("S2");
        dimension1 = jdbc.queryForObject("select dimension_resultado_id from dimension_resultado "
                + "where version_test_id = ? and codigo_dimension = 'DIM-1'", Long.class, versionId);
        optionsS1 = optionsOf("S1");
        optionsS2 = optionsOf("S2");
    }

    @Test
    void dimensionLifecycleEnforcesUniquenessAndDraftOnly() throws Exception {
        String admin = token("CALIFICACION_CONFIGURAR");
        mvc.perform(post("/test-versions/{id}/dimensions", versionId).header("Authorization", admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"FI\",\"name\":\"Fluidez\",\"order\":2,\"minScore\":0,\"maxScore\":20}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.codigoDimension").value("FI"))
                .andExpect(jsonPath("$.data.activa").value(true));
        mvc.perform(post("/test-versions/{id}/dimensions", versionId).header("Authorization", admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"DIM-1\",\"name\":\"Otra\",\"order\":9}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/test-versions/{id}/dimensions", versionId).header("Authorization", admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"OTRA\",\"name\":\"Otra\",\"order\":2}"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/test-versions/{id}/dimensions", versionId).header("Authorization", token("TEST_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].codigoDimension").value("DIM-1"))
                .andExpect(jsonPath("$.data[1].codigoDimension").value("FI"));

        InstrumentVersionFixture.publish(jdbc, versionId, creatorId);
        mvc.perform(post("/test-versions/{id}/dimensions", versionId).header("Authorization", admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"NUEVA\",\"name\":\"Nueva\",\"order\":5}"))
                .andExpect(status().isConflict());
    }

    @Test
    void deleteIsBlockedWhenMatrixOrBaremoReferencesTheDimension() throws Exception {
        String admin = token("CALIFICACION_CONFIGURAR");
        mvc.perform(put("/scoring-rules/{id}/option-scores", ruleS1).header("Authorization", admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(rows(row(optionsS1.get(0), dimension1, 1))))
                .andExpect(status().isOk());

        mvc.perform(delete("/dimensions/{id}", dimension1).header("Authorization", admin))
                .andExpect(status().isConflict());

        long free = jdbc.queryForObject("insert into dimension_resultado (version_test_id, codigo_dimension, "
                + "nombre_dimension, orden_presentacion) values (?, 'LIBRE', 'Libre', 7) "
                + "returning dimension_resultado_id", Long.class, versionId);
        jdbc.update("insert into baremo (version_test_id, dimension_resultado_id, codigo_baremo, nombre) "
                + "values (?, ?, 'BAR-L', 'Baremo libre')", versionId, free);
        mvc.perform(delete("/dimensions/{id}", free).header("Authorization", admin))
                .andExpect(status().isConflict());
        assertThat(jdbc.queryForObject("select count(*) from baremo where dimension_resultado_id = ?",
                Integer.class, free)).isEqualTo(1);

        jdbc.update("delete from baremo where dimension_resultado_id = ?", free);
        mvc.perform(delete("/dimensions/{id}", free).header("Authorization", admin))
                .andExpect(status().isOk());
        em.flush();
        assertThat(jdbc.queryForObject("select count(*) from dimension_resultado where dimension_resultado_id = ?",
                Integer.class, free)).isZero();
    }

    @Test
    void putReplacesTheWholeMatrixIncludingTheSamePair() throws Exception {
        String admin = token("CALIFICACION_CONFIGURAR");
        long a = optionsS1.get(0);
        long b = optionsS1.get(1);
        mvc.perform(put("/scoring-rules/{id}/option-scores", ruleS1).header("Authorization", admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(rows(row(a, dimension1, 1), row(b, dimension1, 2))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));

        mvc.perform(put("/scoring-rules/{id}/option-scores", ruleS1).header("Authorization", admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(rows(row(a, dimension1, 3))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1));

        mvc.perform(get("/scoring-rules/{id}/option-scores", ruleS1).header("Authorization", token("TEST_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].opcionId").value(a))
                .andExpect(jsonPath("$.data[0].puntaje").value(3))
                .andExpect(jsonPath("$.data[0].peso").value(1));

        mvc.perform(put("/scoring-rules/{id}/option-scores", ruleS1).header("Authorization", admin)
                .contentType(MediaType.APPLICATION_JSON).content("{\"rows\":[]}"))
                .andExpect(status().isOk());
        em.flush();
        assertThat(jdbc.queryForObject("select count(*) from opcion_puntaje_dimension where regla_calificacion_id = ?",
                Integer.class, ruleS1)).isZero();
    }

    @Test
    void putRejectsOptionOutsideRuleScopeAndDuplicatePairs() throws Exception {
        String admin = token("CALIFICACION_CONFIGURAR");
        mvc.perform(put("/scoring-rules/{id}/option-scores", ruleS1).header("Authorization", admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(rows(row(optionsS2.get(0), dimension1, 1))))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/scoring-rules/{id}/option-scores", ruleS2).header("Authorization", admin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(rows(row(optionsS2.get(0), dimension1, 1), row(optionsS2.get(0), dimension1, 2))))
                .andExpect(status().isBadRequest());
    }

    private long ruleOf(String subtestCode) {
        return jdbc.queryForObject("select r.regla_calificacion_id from regla_calificacion r "
                + "join subtest s on s.subtest_id = r.subtest_id where r.version_test_id = ? and s.codigo_subtest = ? "
                + "order by r.regla_calificacion_id limit 1", Long.class, versionId, subtestCode);
    }

    private List<Long> optionsOf(String subtestCode) {
        return jdbc.queryForList("select o.opcion_id from opcion_item o join item i on i.item_id = o.item_id "
                + "join subtest s on s.subtest_id = i.subtest_id where s.version_test_id = ? and s.codigo_subtest = ? "
                + "order by o.opcion_id", Long.class, versionId, subtestCode);
    }

    private static String row(long option, long dimension, int score) {
        return "{\"optionId\":" + option + ",\"dimensionId\":" + dimension + ",\"score\":" + score + "}";
    }

    private static String rows(String... rows) {
        return "{\"rows\":[" + String.join(",", rows) + "]}";
    }

    private String token(String permission) {
        return "Bearer " + jwt.emitir(creatorId, "dim", Set.of(permission), Set.of("PSICOLOGO_COORDINADOR"));
    }
}
