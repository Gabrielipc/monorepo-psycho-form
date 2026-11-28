package com.uam.psychoform.instrument.dto;

import com.uam.psychoform.instrument.model.OpcionPuntajeDimension;
import java.math.BigDecimal;

/** Vista de una fila de {@code opcion_puntaje_dimension}; nombres alineados con la entidad. */
public record OptionScoreDTO(Long id, Long reglaCalificacionId, Long opcionId, Long dimensionResultadoId,
        BigDecimal puntaje, BigDecimal peso, Boolean activa) {
    public static OptionScoreDTO from(OpcionPuntajeDimension row) {
        return new OptionScoreDTO(row.getId(), row.getReglaCalificacion().getId(), row.getOpcion().getId(),
                row.getDimensionResultado().getId(), row.getPuntaje(), row.getPeso(), row.getActiva());
    }
}
