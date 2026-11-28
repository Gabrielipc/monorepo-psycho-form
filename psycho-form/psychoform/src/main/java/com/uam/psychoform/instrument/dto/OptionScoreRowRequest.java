package com.uam.psychoform.instrument.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;

/** Fila de la matriz opcion-dimension; {@code weight} omitido equivale a 1 y {@code active} omitido a true. */
public record OptionScoreRowRequest(@NotNull Long optionId, @NotNull Long dimensionId,
        @NotNull @DecimalMin("0") @Digits(integer = 6, fraction = 2) BigDecimal score,
        @Positive @Digits(integer = 4, fraction = 4) BigDecimal weight, Boolean active) {
}
