package com.uam.psychoform.scoring.service;

import com.uam.psychoform.instrument.model.EstrategiaCalificacion;
import com.uam.psychoform.scoring.service.strategy.ScoringStrategy;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

/** Registro de las estrategias de calificacion disponibles (todas las implementaciones {@link ScoringStrategy}). */
@Component
public class ScoringStrategyRegistry {
    private final Map<String, ScoringStrategy> byCode = new LinkedHashMap<>();

    public ScoringStrategyRegistry(List<ScoringStrategy> strategies) {
        for (ScoringStrategy strategy : strategies) {
            String code = strategy.code();
            if (code == null || code.isBlank()) {
                throw new IllegalStateException("La estrategia " + strategy.getClass().getName() + " no define codigo");
            }
            if (strategy.descriptor() == null || !code.equals(strategy.descriptor().code())) {
                throw new IllegalStateException("El codigo de la estrategia " + code
                        + " no coincide con el de su descriptor");
            }
            if (byCode.putIfAbsent(code, strategy) != null) {
                throw new IllegalStateException("Hay mas de una estrategia de calificacion con el codigo " + code);
            }
        }
    }

    public Optional<ScoringStrategy> find(String code) {
        return Optional.ofNullable(code == null ? null : byCode.get(code));
    }

    public boolean isImplemented(String code) {
        return find(code).isPresent();
    }

    /** Estrategias registradas, en orden de registro. */
    public List<ScoringStrategy> all() {
        return List.copyOf(byCode.values());
    }

    /** Implementacion de la estrategia del catalogo; falla si la version no tiene estrategia o no esta implementada. */
    public ScoringStrategy require(EstrategiaCalificacion estrategia) {
        if (estrategia == null) {
            throw new IllegalStateException("La version no tiene estrategia de calificacion");
        }
        return find(estrategia.getCodigo()).orElseThrow(() -> new IllegalStateException(
                "La estrategia " + estrategia.getCodigo() + " no tiene implementacion registrada"));
    }
}
