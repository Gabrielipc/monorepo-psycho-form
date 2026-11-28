package com.uam.psychoform.instrument.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/** Conjunto completo de filas de matriz de una regla; reemplaza el existente. Una lista vacia lo vacia. */
public record OptionScoresRequest(@NotNull List<@Valid OptionScoreRowRequest> rows) {
}
