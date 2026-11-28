package com.uam.psychoform.instrument.dto;

import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

/** Edicion parcial de una dimension: los campos nulos conservan el valor actual. */
public record DimensionPatchRequest(@Size(max = 60) @Pattern(regexp = ".*\\S.*", message = "no puede estar en blanco") String code,
        @Size(max = 150) @Pattern(regexp = ".*\\S.*", message = "no puede estar en blanco") String name,
        String description, Long subtestId, Integer order,
        @Digits(integer = 8, fraction = 2) BigDecimal minScore,
        @Digits(integer = 8, fraction = 2) BigDecimal maxScore, Boolean active) {
}
