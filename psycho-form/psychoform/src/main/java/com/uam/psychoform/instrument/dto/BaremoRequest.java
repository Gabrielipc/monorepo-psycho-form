package com.uam.psychoform.instrument.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;

public record BaremoRequest(@NotNull Long versionId, Long dimensionId, @NotBlank String code,
        @NotBlank String name, String description, String normativeGroup,
        @Min(0) @Max(120) Short minAge, @Min(0) @Max(120) Short maxAge, Short sexId, Short careerId,
        LocalDate validFrom, LocalDate validTo, Boolean clearNormativeCriteria) {
}
