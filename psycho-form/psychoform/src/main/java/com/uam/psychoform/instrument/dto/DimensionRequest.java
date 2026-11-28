package com.uam.psychoform.instrument.dto;

import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

/** Alta de una dimension de resultado (escala) de una version en borrador. */
public record DimensionRequest(@NotBlank @Size(max = 60) String code, @NotBlank @Size(max = 150) String name,
        String description, Long subtestId, @NotNull Integer order,
        @Digits(integer = 8, fraction = 2) BigDecimal minScore,
        @Digits(integer = 8, fraction = 2) BigDecimal maxScore, Boolean active) {
}
