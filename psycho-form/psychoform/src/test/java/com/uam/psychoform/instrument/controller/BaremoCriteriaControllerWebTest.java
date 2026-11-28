package com.uam.psychoform.instrument.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.uam.psychoform.PsychoformApplication;
import com.uam.psychoform.instrument.model.Baremo;
import com.uam.psychoform.instrument.service.InstrumentAdminService;
import com.uam.psychoform.instrument.service.InstrumentImageService;
import com.uam.psychoform.instrument.service.ScoringDimensionAdminService;
import com.uam.psychoform.instrument.service.VersionTestService;
import com.uam.psychoform.security.service.JwtService;
import java.time.LocalDate;
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
class BaremoCriteriaControllerWebTest {
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

    @Test
    void createMapsCriteriaToCommand() throws Exception {
        when(admin.createBaremo(any())).thenReturn(new Baremo());

        mvc.perform(post("/baremos").header("Authorization", "Bearer " + token())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"versionId\":1,\"code\":\"B\",\"name\":\"N\",\"minAge\":18,\"maxAge\":30,\"sexId\":1,"
                        + "\"careerId\":2,\"validFrom\":\"2026-01-01\",\"validTo\":\"2026-12-31\"}"))
                .andExpect(status().isOk());

        ArgumentCaptor<InstrumentAdminService.BaremoCommand> captor =
                ArgumentCaptor.forClass(InstrumentAdminService.BaremoCommand.class);
        verify(admin).createBaremo(captor.capture());
        InstrumentAdminService.BaremoCommand command = captor.getValue();
        assertThat(command.minAge()).isEqualTo((short) 18);
        assertThat(command.maxAge()).isEqualTo((short) 30);
        assertThat(command.sexId()).isEqualTo((short) 1);
        assertThat(command.careerId()).isEqualTo((short) 2);
        assertThat(command.validFrom()).isEqualTo(LocalDate.of(2026, 1, 1));
        assertThat(command.validTo()).isEqualTo(LocalDate.of(2026, 12, 31));
    }

    @Test
    void patchWithoutCriteriaSendsNulls() throws Exception {
        when(admin.updateBaremo(eq(9L), any())).thenReturn(new Baremo());

        mvc.perform(patch("/baremos/{id}", 9L).header("Authorization", "Bearer " + token())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"versionId\":1,\"code\":\"B\",\"name\":\"N2\",\"clearNormativeCriteria\":true}"))
                .andExpect(status().isOk());

        ArgumentCaptor<InstrumentAdminService.BaremoCommand> captor =
                ArgumentCaptor.forClass(InstrumentAdminService.BaremoCommand.class);
        verify(admin).updateBaremo(eq(9L), captor.capture());
        assertThat(captor.getValue().minAge()).isNull();
        assertThat(captor.getValue().clearNormativeCriteria()).isTrue();
    }

    @Test
    void ageOutOfRangeIsBadRequest() throws Exception {
        for (String field : new String[] {"\"minAge\":-1", "\"maxAge\":121"}) {
            mvc.perform(post("/baremos").header("Authorization", "Bearer " + token())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"versionId\":1,\"code\":\"B\",\"name\":\"N\"," + field + "}"))
                    .andExpect(status().isBadRequest());
        }
        verify(admin, never()).createBaremo(any());
    }

    @Test
    void invalidCriteriaFromServiceIsBadRequest() throws Exception {
        when(admin.createBaremo(any())).thenThrow(new IllegalArgumentException("La edad minima no puede ser mayor"));

        mvc.perform(post("/baremos").header("Authorization", "Bearer " + token())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"versionId\":1,\"code\":\"B\",\"name\":\"N\",\"minAge\":40,\"maxAge\":20}"))
                .andExpect(status().isBadRequest());
    }

    private String token() {
        return jwt.emitir(UUID.fromString("44444444-4444-4444-4444-444444444444"), "ana",
                Set.of("BAREMO_CONFIGURAR"), Set.of("PSICOLOGO_COORDINADOR"));
    }
}
