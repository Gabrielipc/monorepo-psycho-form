package com.uam.psychoform.scoring.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.uam.psychoform.instrument.model.EstrategiaCalificacion;
import com.uam.psychoform.instrument.model.TipoEstrategiaCalificacion;
import com.uam.psychoform.scoring.service.strategy.ClaveSimpleScoringStrategy;
import com.uam.psychoform.scoring.service.strategy.ScoringContext;
import com.uam.psychoform.scoring.service.strategy.ScoringOutcome;
import com.uam.psychoform.scoring.service.strategy.ScoringStrategy;
import com.uam.psychoform.scoring.service.strategy.StrategyDescriptor;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;

class ScoringStrategyRegistryTest {
    private static ScoringStrategy fake(String code, String descriptorCode) {
        return new ScoringStrategy() {
            @Override
            public String code() {
                return code;
            }

            @Override
            public StrategyDescriptor descriptor() {
                return new StrategyDescriptor(descriptorCode, "Fake", null, TipoEstrategiaCalificacion.FORMULA_CONTROLADA,
                        false, false);
            }

            @Override
            public ScoringOutcome score(ScoringContext context) {
                return new ScoringOutcome(BigDecimal.ZERO, List.of(), List.of());
            }
        };
    }

    private static EstrategiaCalificacion entity(String code) {
        EstrategiaCalificacion estrategia = new EstrategiaCalificacion();
        estrategia.setCodigo(code);
        return estrategia;
    }

    @Test
    void registraYResuelveEstrategiasPorCodigo() {
        ClaveSimpleScoringStrategy clave = new ClaveSimpleScoringStrategy();
        ScoringStrategyRegistry registry = new ScoringStrategyRegistry(List.of(clave, fake("OTRA", "OTRA")));

        assertThat(registry.find("CLAVE_SIMPLE")).containsSame(clave);
        assertThat(registry.find("NO_EXISTE")).isEmpty();
        assertThat(registry.find(null)).isEmpty();
        assertThat(registry.isImplemented("OTRA")).isTrue();
        assertThat(registry.isImplemented("NO_EXISTE")).isFalse();
        assertThat(registry.require(entity("CLAVE_SIMPLE"))).isSameAs(clave);
        assertThat(registry.all()).hasSize(2);
    }

    @Test
    void codigoDuplicadoFallaEnElConstructor() {
        assertThatThrownBy(() -> new ScoringStrategyRegistry(List.of(fake("X", "X"), fake("X", "X"))))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("X");
    }

    @Test
    void codigoQueNoCoincideConElDescriptorFallaEnElConstructor() {
        assertThatThrownBy(() -> new ScoringStrategyRegistry(List.of(fake("X", "Y"))))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("descriptor");
    }

    @Test
    void requireDeEstrategiaNoImplementadaResponde409ConElCodigo() {
        ScoringStrategyRegistry registry = new ScoringStrategyRegistry(List.of(new ClaveSimpleScoringStrategy()));

        assertThatThrownBy(() -> registry.require(entity("LIKERT_ESCALA")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("La estrategia LIKERT_ESCALA no tiene implementacion registrada");
    }

    @Test
    void requireNuloFalla() {
        ScoringStrategyRegistry registry = new ScoringStrategyRegistry(List.of());

        assertThatThrownBy(() -> registry.require(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("La version no tiene estrategia de calificacion");
    }
}
