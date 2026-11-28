package com.uam.psychoform.scoring.service;

import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.scoring.model.Resultado;
import com.uam.psychoform.scoring.service.strategy.ScoringContext;
import com.uam.psychoform.scoring.service.strategy.ScoringOutcome;
import com.uam.psychoform.scoring.service.strategy.ScoringStrategy;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Recalcula un resultado existente con la estrategia de su version (por ejemplo, tras guardar una revision manual).
 * No es un servicio con permisos: lo invocan servicios que ya autorizaron la operacion.
 */
@Component
@Transactional
public class ResultRecalculator {
    private final ScoringStrategyRegistry registry;
    private final ScoringContextLoader loader;
    private final ScoringResultWriter writer;

    public ResultRecalculator(ScoringStrategyRegistry registry, ScoringContextLoader loader,
            ScoringResultWriter writer) {
        this.registry = registry;
        this.loader = loader;
        this.writer = writer;
    }

    public void recalculate(Resultado resultado) {
        IntentoTest intento = resultado.getIntento();
        ScoringStrategy strategy = registry.require(
                intento.getAsignacion().getSesionAplicacion().getVersionTest().getEstrategiaCalificacion());
        ScoringContext context = loader.load(intento);
        ScoringOutcome outcome = strategy.score(context);
        ScoringOutcomeValidator.validate(outcome, context);
        writer.reconcile(resultado, outcome, context);
    }
}
