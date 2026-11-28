package com.uam.psychoform.scoring.service;

import com.uam.psychoform.scoring.service.strategy.ScoringStrategy;
import com.uam.psychoform.scoring.service.strategy.StrategyDescriptor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Al iniciar, registra en {@code estrategia_calificacion} las estrategias implementadas que aun no tienen fila. Nunca
 * modifica ni desactiva filas existentes. Se desactiva con {@code psychoform.scoring.catalog-sync.enabled=false}.
 */
@Component
@ConditionalOnProperty(name = "psychoform.scoring.catalog-sync.enabled", havingValue = "true", matchIfMissing = true)
public class ScoringStrategyCatalogSynchronizer implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(ScoringStrategyCatalogSynchronizer.class);
    private static final String INSERT = """
            INSERT INTO estrategia_calificacion
                (codigo, nombre, descripcion, tipo_estrategia, requiere_revision_manual, permite_baremo)
            VALUES (?, ?, ?, CAST(? AS tipo_estrategia_calificacion), ?, ?)
            ON CONFLICT (codigo) DO NOTHING
            """;

    private final ScoringStrategyRegistry registry;
    private final JdbcTemplate jdbc;

    public ScoringStrategyCatalogSynchronizer(ScoringStrategyRegistry registry, JdbcTemplate jdbc) {
        this.registry = registry;
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        synchronize();
    }

    /** Inserta las filas faltantes y devuelve cuantas se crearon. */
    public int synchronize() {
        int created = 0;
        for (ScoringStrategy strategy : registry.all()) {
            StrategyDescriptor descriptor = strategy.descriptor();
            int inserted = jdbc.update(INSERT, descriptor.code(), descriptor.name(), descriptor.description(),
                    descriptor.type().name(), descriptor.requiresManualReview(), descriptor.allowsBaremo());
            if (inserted > 0) {
                log.info("Estrategia de calificacion registrada en el catalogo: {}", descriptor.code());
            }
            created += inserted;
        }
        return created;
    }
}
