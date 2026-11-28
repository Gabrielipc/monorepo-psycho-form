package com.uam.psychoform.instrument.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.instrument.dto.DimensionDTO;
import com.uam.psychoform.instrument.dto.OptionScoreDTO;
import com.uam.psychoform.instrument.service.InstrumentAdminService;
import com.uam.psychoform.instrument.service.InstrumentImageService;
import com.uam.psychoform.instrument.service.ScoringDimensionAdminService;
import com.uam.psychoform.instrument.service.VersionTestService;
import com.uam.psychoform.security.service.JwtService;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(classes = PsychoformApplication.class)
@AutoConfigureMockMvc
class ScoringDimensionControllerWebTest {
    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @MockitoBean
    InstrumentAdminService admin;

    @MockitoBean
    VersionTestService versions;

    @MockitoBean
    InstrumentImageService images;

    @MockitoBean
    ScoringDimensionAdminService dimensions;

    private static DimensionDTO dto() {
        return new DimensionDTO(10L, 1L, 5L, "FI", "Fluidez", null, 1, null, null, true, null);
    }

    @Test
    void listDimensionsReturnsDtosForReaders() throws Exception {
        when(dimensions.listDimensions(1L)).thenReturn(List.of(dto()));

        mvc.perform(get("/test-versions/{id}/dimensions", 1L).header("Authorization", "Bearer " + token("TEST_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(10))
                .andExpect(jsonPath("$.data[0].codigoDimension").value("FI"))
                .andExpect(jsonPath("$.data[0].subtestId").value(5));
    }

    @Test
    void createDimensionDelegatesCommand() throws Exception {
        when(dimensions.createDimension(eq(1L), any())).thenReturn(dto());

        mvc.perform(post("/test-versions/{id}/dimensions", 1L)
                .header("Authorization", "Bearer " + token("CALIFICACION_CONFIGURAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"FI\",\"name\":\"Fluidez\",\"subtestId\":5,\"order\":1,\"minScore\":0,\"maxScore\":10}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.nombreDimension").value("Fluidez"));

        ArgumentCaptor<ScoringDimensionAdminService.DimensionCommand> captor =
                ArgumentCaptor.forClass(ScoringDimensionAdminService.DimensionCommand.class);
        verify(dimensions).createDimension(eq(1L), captor.capture());
        org.assertj.core.api.Assertions.assertThat(captor.getValue().code()).isEqualTo("FI");
        org.assertj.core.api.Assertions.assertThat(captor.getValue().subtestId()).isEqualTo(5L);
    }

    @Test
    void createDimensionValidatesBody() throws Exception {
        mvc.perform(post("/test-versions/{id}/dimensions", 1L)
                .header("Authorization", "Bearer " + token("CALIFICACION_CONFIGURAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"\",\"name\":\"Fluidez\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void createDimensionRequiresConfigurePermission() throws Exception {
        mvc.perform(post("/test-versions/{id}/dimensions", 1L)
                .header("Authorization", "Bearer " + token("TEST_LEER"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"FI\",\"name\":\"Fluidez\",\"order\":1}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void createDimensionOnNonDraftVersionIsConflict() throws Exception {
        when(dimensions.createDimension(eq(1L), any()))
                .thenThrow(new IllegalStateException("La version publicada o aprobada no se edita directamente"));

        mvc.perform(post("/test-versions/{id}/dimensions", 1L)
                .header("Authorization", "Bearer " + token("CALIFICACION_CONFIGURAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"FI\",\"name\":\"Fluidez\",\"order\":1}"))
                .andExpect(status().isConflict());
    }

    @Test
    void createDimensionDuplicateIsBadRequest() throws Exception {
        when(dimensions.createDimension(eq(1L), any()))
                .thenThrow(new IllegalArgumentException("Ya existe una dimension con codigo FI en la version"));

        mvc.perform(post("/test-versions/{id}/dimensions", 1L)
                .header("Authorization", "Bearer " + token("CALIFICACION_CONFIGURAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"code\":\"FI\",\"name\":\"Fluidez\",\"order\":1}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void patchDimensionAcceptsPartialBody() throws Exception {
        when(dimensions.updateDimension(eq(10L), any())).thenReturn(dto());

        mvc.perform(patch("/dimensions/{id}", 10L)
                .header("Authorization", "Bearer " + token("CALIFICACION_CONFIGURAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"active\":false}"))
                .andExpect(status().isOk());

        ArgumentCaptor<ScoringDimensionAdminService.DimensionCommand> captor =
                ArgumentCaptor.forClass(ScoringDimensionAdminService.DimensionCommand.class);
        verify(dimensions).updateDimension(eq(10L), captor.capture());
        org.assertj.core.api.Assertions.assertThat(captor.getValue().active()).isFalse();
        org.assertj.core.api.Assertions.assertThat(captor.getValue().code()).isNull();
    }

    @Test
    void deleteReferencedDimensionIsConflict() throws Exception {
        org.mockito.Mockito.doThrow(new IllegalStateException("desactivela (active=false)"))
                .when(dimensions).deleteDimension(10L);

        mvc.perform(delete("/dimensions/{id}", 10L)
                .header("Authorization", "Bearer " + token("CALIFICACION_CONFIGURAR")))
                .andExpect(status().isConflict());
    }

    @Test
    void deleteDimensionSucceeds() throws Exception {
        mvc.perform(delete("/dimensions/{id}", 10L)
                .header("Authorization", "Bearer " + token("CALIFICACION_CONFIGURAR")))
                .andExpect(status().isOk());
        verify(dimensions).deleteDimension(10L);
    }

    @Test
    void getOptionScoresReturnsRows() throws Exception {
        when(dimensions.listOptionScores(40L)).thenReturn(List.of(
                new OptionScoreDTO(1L, 40L, 30L, 10L, BigDecimal.ONE, BigDecimal.ONE, true)));

        mvc.perform(get("/scoring-rules/{id}/option-scores", 40L)
                .header("Authorization", "Bearer " + token("TEST_LEER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].opcionId").value(30))
                .andExpect(jsonPath("$.data[0].dimensionResultadoId").value(10));
    }

    @Test
    void putOptionScoresReplacesSetAndMapsRows() throws Exception {
        when(dimensions.replaceOptionScores(eq(40L), any())).thenReturn(List.of(
                new OptionScoreDTO(1L, 40L, 30L, 10L, BigDecimal.ONE, BigDecimal.ONE, true)));

        mvc.perform(put("/scoring-rules/{id}/option-scores", 40L)
                .header("Authorization", "Bearer " + token("CALIFICACION_CONFIGURAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"rows\":[{\"optionId\":30,\"dimensionId\":10,\"score\":1,\"weight\":2}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(1));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<ScoringDimensionAdminService.OptionScoreRow>> captor = ArgumentCaptor.forClass(List.class);
        verify(dimensions).replaceOptionScores(eq(40L), captor.capture());
        org.assertj.core.api.Assertions.assertThat(captor.getValue()).singleElement().satisfies(row -> {
            org.assertj.core.api.Assertions.assertThat(row.optionId()).isEqualTo(30L);
            org.assertj.core.api.Assertions.assertThat(row.weight()).isEqualByComparingTo("2");
        });
    }

    @Test
    void putOptionScoresRejectsNegativeScoreAndMissingRows() throws Exception {
        mvc.perform(put("/scoring-rules/{id}/option-scores", 40L)
                .header("Authorization", "Bearer " + token("CALIFICACION_CONFIGURAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"rows\":[{\"optionId\":30,\"dimensionId\":10,\"score\":-1}]}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/scoring-rules/{id}/option-scores", 40L)
                .header("Authorization", "Bearer " + token("CALIFICACION_CONFIGURAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/scoring-rules/{id}/option-scores", 40L)
                .header("Authorization", "Bearer " + token("CALIFICACION_CONFIGURAR"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"rows\":[{\"optionId\":30,\"dimensionId\":10,\"score\":1,\"weight\":0}]}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void putOptionScoresRequiresConfigurePermission() throws Exception {
        mvc.perform(put("/scoring-rules/{id}/option-scores", 40L)
                .header("Authorization", "Bearer " + token("TEST_LEER"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"rows\":[]}"))
                .andExpect(status().isForbidden());
    }

    private String token(String permission) {
        return jwt.emitir(UUID.fromString("44444444-4444-4444-4444-444444444444"), "ana",
                Set.of(permission), Set.of("PSICOLOGO_COORDINADOR"));
    }
}
