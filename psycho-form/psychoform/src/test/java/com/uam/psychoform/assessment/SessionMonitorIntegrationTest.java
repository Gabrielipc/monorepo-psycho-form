package com.uam.psychoform.assessment;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.security.service.JwtService;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.Map;
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

/**
 * Monitor de sesion (B3, B11, B17) sobre la BD real. Transaccional: los datos se revierten al terminar.
 */
@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
@Transactional
class SessionMonitorIntegrationTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @Autowired
    JdbcTemplate jdbc;

    private UUID userId;
    private long versionId;
    private long sessionId;
    private UUID participantA;
    private UUID participantB;
    private long assignmentA;
    private long assignmentB;

    @BeforeEach
    void seed() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        userId = jdbc.queryForObject("insert into usuario (nombre_usuario, correo, hash_contrasena, nombre_completo) "
                + "values (?, ?, 'x', 'Aplicador Monitor') returning usuario_id", UUID.class,
                "mon-" + suffix, "mon-" + suffix + "@test.local");
        long estrategiaId = id("select estrategia_calificacion_id from estrategia_calificacion "
                + "where codigo = 'CLAVE_SIMPLE'");
        long testId = id("insert into test (codigo_test, nombre_test) values (?, ?) returning test_id",
                "MON-" + suffix, "Test monitor " + suffix);
        versionId = id("insert into version_test (test_id, estrategia_calificacion_id, numero_version, estado) "
                + "values (?, ?, '1.0', 'BORRADOR') returning version_test_id", testId, estrategiaId);
        id("insert into subtest (version_test_id, codigo_subtest, nombre_subtest, numero_orden) "
                + "values (?, 'SUB-1', 'Subtest 1', 1) returning subtest_id", versionId);
        jdbc.update("update version_test set estado = 'PUBLICADO', aprobado_por = ?, aprobado_en = now(), "
                + "publicado_en = now() where version_test_id = ?", userId, versionId);
        sessionId = id("insert into sesion_aplicacion (version_test_id, codigo_sesion, nombre_sesion, "
                + "inicio_programado, estado) values (?, ?, ?, now(), 'ABIERTA') "
                + "returning sesion_aplicacion_id", versionId, "SES-" + suffix, "Sesion " + suffix);
        participantA = insertParticipant("PA-" + suffix, "Ana", "Perez");
        participantB = insertParticipant("PB-" + suffix, "Beto", "Gomez");
        assignmentA = insertAssignment(sessionId, participantA, "ASIGNADO", LocalDateTime.now().plusHours(8));
        assignmentB = insertAssignment(sessionId, participantB, "ASIGNADO", LocalDateTime.now().plusHours(8));
    }

    // ---- B3 ----

    @Test
    void registraDosIncidenciasYLasListaEnOrdenConTextoParticipanteYAutor() throws Exception {
        postIncidence(participantA, "Primera incidencia");
        postIncidence(null, "Segunda incidencia, sin participante");

        mvc.perform(get("/sesiones/{id}/incidencias", sessionId).header("Authorization", bearer("SESION_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].text").value("Primera incidencia"))
                .andExpect(jsonPath("$.data[0].participantId").value(participantA.toString()))
                .andExpect(jsonPath("$.data[0].participantName").value("Ana Perez"))
                .andExpect(jsonPath("$.data[0].recordedBy").value("Aplicador Monitor"))
                .andExpect(jsonPath("$.data[0].recordedAt").isNotEmpty())
                .andExpect(jsonPath("$.data[0].id").isNumber())
                .andExpect(jsonPath("$.data[1].text").value("Segunda incidencia, sin participante"))
                .andExpect(jsonPath("$.data[1].participantId").doesNotExist())
                .andExpect(jsonPath("$.data[1].participantName").doesNotExist());
    }

    @Test
    void textoConComillasBarrasYSaltosDeLineaSeGuardaYSeLeeIgual() throws Exception {
        String text = "Dijo \"alto\" \\ barra\ny salto\r\ncon tab\t y unicode: ñ";
        postIncidence(participantA, text);

        mvc.perform(get("/sesiones/{id}/incidencias", sessionId).header("Authorization", bearer("SESION_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].text").value(text));
    }

    @Test
    void listarIncidenciasDeSesionInexistenteEs404() throws Exception {
        mvc.perform(get("/sesiones/{id}/incidencias", 999_999_999L).header("Authorization", bearer("SESION_LEER")))
                .andExpect(status().isNotFound());
    }

    @Test
    void consultorSinSesionLeerNoPuedeListarIncidencias() throws Exception {
        mvc.perform(get("/sesiones/{id}/incidencias", sessionId)
                .header("Authorization", bearer("RESULTADO_VER")))
                .andExpect(status().isForbidden());
    }

    @Test
    void incidenciaConTextoVacioOMuyLargoEs400() throws Exception {
        for (String text : new String[] { "", "   ", "x".repeat(1001) }) {
            mvc.perform(post("/sesiones/{id}/incidencias", sessionId).header("Authorization", bearer("SESION_APLICAR"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(JSON.writeValueAsString(Map.of("text", text))))
                    .andExpect(status().isBadRequest());
        }
        mvc.perform(post("/sesiones/{id}/incidencias", sessionId).header("Authorization", bearer("SESION_APLICAR"))
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void incidenciaConParticipanteNoAsignadoALaSesionEs400() throws Exception {
        mvc.perform(post("/sesiones/{id}/incidencias", sessionId).header("Authorization", bearer("SESION_APLICAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(JSON.writeValueAsString(Map.of("participantId", UUID.randomUUID().toString(),
                        "text", "ajeno"))))
                .andExpect(status().isBadRequest());
    }

    // ---- helpers ----

    private void postIncidence(UUID participantId, String text) throws Exception {
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        if (participantId != null) {
            body.put("participantId", participantId.toString());
        }
        body.put("text", text);
        mvc.perform(post("/sesiones/{id}/incidencias", sessionId).header("Authorization", bearer("SESION_APLICAR"))
                .contentType(MediaType.APPLICATION_JSON).content(JSON.writeValueAsString(body)))
                .andExpect(status().isOk());
    }

    private UUID insertParticipant(String code, String firstNames, String lastNames) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into participante (participante_id, codigo_participante, nombres, apellidos) "
                + "values (?, ?, ?, ?)", id, code, firstNames, lastNames);
        return id;
    }

    private long insertAssignment(long session, UUID participantId, String state, LocalDateTime tokenExpiresAt) {
        return id("insert into asignacion_test (sesion_aplicacion_id, participante_id, evaluador_id, "
                + "token_acceso_hash, token_expira_en, estado) "
                + "values (?, ?, ?, ?, ?, cast(? as estado_asignacion)) returning asignacion_id",
                session, participantId, userId, UUID.randomUUID().toString().replace("-", ""),
                Timestamp.valueOf(tokenExpiresAt), state);
    }

    private long id(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    /** El token lleva el usuario sembrado, para que la auditoria resuelva el autor. */
    private String bearer(String permission) {
        return "Bearer " + jwt.emitir(userId, "monitor", Set.of(permission), Set.of("ROL_PRUEBA"));
    }
}
