package com.uam.psychoform.scoring.service.strategy;

import java.util.List;

/**
 * Punto de extension para reglas de calificacion propias. Para agregar un test con reglas nuevas basta una clase
 * {@code @Component} que implemente esta interfaz: se registra sola, aparece en el catalogo de estrategias y se
 * invoca al calificar y al recalcular resultados de las versiones que la usen.
 */
public interface ScoringStrategy {
    /** Codigo de {@code estrategia_calificacion.codigo} que implementa. Unico entre estrategias. */
    String code();

    /** Fila de catalogo que se registra si no existe. */
    StrategyDescriptor descriptor();

    /**
     * Problemas de configuracion que impiden publicar la version. Lista vacia significa publicable. Los mensajes deben
     * ser accionables para quien configura el test.
     */
    default List<String> validateConfiguration(ScoringConfiguration configuration) {
        return List.of();
    }

    /** Calculo puro: no accede a BD ni a seguridad; solo lee el contexto y devuelve el resultado. */
    ScoringOutcome score(ScoringContext context);
}
