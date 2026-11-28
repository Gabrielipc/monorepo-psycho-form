package com.uam.psychoform.instrument.dto;

import com.uam.psychoform.instrument.model.EstrategiaCalificacion;
import com.uam.psychoform.instrument.model.TipoEstrategiaCalificacion;
import java.time.LocalDateTime;

/**
 * Estrategia del catalogo con los mismos campos que la entidad, mas {@code implemented}: si el backend tiene una
 * implementacion registrada. Una version solo puede publicarse con una estrategia implementada.
 */
public record ScoringStrategyDTO(Short id, String codigo, String nombre, String descripcion,
        TipoEstrategiaCalificacion tipoEstrategia, Boolean activa, Boolean requiereRevisionManual,
        Boolean permiteBaremo, LocalDateTime fechaCreacion, boolean implemented) {
    public static ScoringStrategyDTO from(EstrategiaCalificacion strategy, boolean implemented) {
        return new ScoringStrategyDTO(strategy.getId(), strategy.getCodigo(), strategy.getNombre(),
                strategy.getDescripcion(), strategy.getTipoEstrategia(), strategy.getActiva(),
                strategy.getRequiereRevisionManual(), strategy.getPermiteBaremo(), strategy.getFechaCreacion(),
                implemented);
    }
}
