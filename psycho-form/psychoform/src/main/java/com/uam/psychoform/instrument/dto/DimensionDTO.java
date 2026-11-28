package com.uam.psychoform.instrument.dto;

import com.uam.psychoform.instrument.model.DimensionResultado;
import java.math.BigDecimal;
import java.time.LocalDateTime;

/** Vista de una dimension de resultado; los nombres siguen los de la entidad, como el resto de lecturas de configuracion. */
public record DimensionDTO(Long id, Long versionTestId, Long subtestId, String codigoDimension,
        String nombreDimension, String descripcion, Integer ordenPresentacion, BigDecimal puntajeMinimo,
        BigDecimal puntajeMaximo, Boolean activa, LocalDateTime creadoEn) {
    public static DimensionDTO from(DimensionResultado dimension) {
        return new DimensionDTO(dimension.getId(), dimension.getVersionTest().getId(),
                dimension.getSubtest() == null ? null : dimension.getSubtest().getId(),
                dimension.getCodigoDimension(), dimension.getNombreDimension(), dimension.getDescripcion(),
                dimension.getOrdenPresentacion(), dimension.getPuntajeMinimo(), dimension.getPuntajeMaximo(),
                dimension.getActiva(), dimension.getCreadoEn());
    }
}
