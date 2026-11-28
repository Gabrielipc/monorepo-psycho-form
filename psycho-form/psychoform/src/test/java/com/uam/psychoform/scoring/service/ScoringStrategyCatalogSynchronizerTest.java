package com.uam.psychoform.scoring.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.uam.psychoform.scoring.service.strategy.ClaveSimpleScoringStrategy;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.jdbc.core.JdbcTemplate;

class ScoringStrategyCatalogSynchronizerTest {
    private final JdbcTemplate jdbc = Mockito.mock(JdbcTemplate.class);
    private final ScoringStrategyCatalogSynchronizer synchronizer = new ScoringStrategyCatalogSynchronizer(
            new ScoringStrategyRegistry(List.of(new ClaveSimpleScoringStrategy())), jdbc);

    @Test
    void insertaSoloSiNoExisteConOnConflictDoNothingYReportaLasCreadas() {
        when(jdbc.update(Mockito.contains("ON CONFLICT (codigo) DO NOTHING"), Mockito.eq("CLAVE_SIMPLE"),
                Mockito.eq("Clave simple"), Mockito.anyString(), Mockito.eq("CLAVE_SIMPLE"), Mockito.eq(false),
                Mockito.eq(true))).thenReturn(1);

        assertThat(synchronizer.synchronize()).isEqualTo(1);
    }

    @Test
    void siLaFilaYaExisteNoSeCreaNada() {
        when(jdbc.update(Mockito.anyString(), Mockito.<Object[]>any())).thenReturn(0);

        assertThat(synchronizer.synchronize()).isZero();
    }
}
