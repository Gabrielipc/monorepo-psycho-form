package com.uam.psychoform.scoring.service.strategy;

import com.uam.psychoform.instrument.model.TipoEstrategiaCalificacion;

/**
 * Fila de catalogo ({@code estrategia_calificacion}) que describe a una estrategia. Se registra automaticamente si su
 * codigo aun no existe en la base de datos.
 *
 * @param code codigo unico de la estrategia
 * @param name nombre visible
 * @param description descripcion breve
 * @param type tipo de estrategia del catalogo
 * @param requiresManualReview si la estrategia puede dejar items pendientes de revision manual
 * @param allowsBaremo si los puntajes de la estrategia pueden interpretarse con baremos
 */
public record StrategyDescriptor(String code, String name, String description, TipoEstrategiaCalificacion type,
        boolean requiresManualReview, boolean allowsBaremo) {
}
