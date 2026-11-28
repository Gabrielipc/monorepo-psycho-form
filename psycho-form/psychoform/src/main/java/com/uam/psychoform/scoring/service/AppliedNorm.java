package com.uam.psychoform.scoring.service;

import com.uam.psychoform.instrument.model.Baremo;
import com.uam.psychoform.instrument.model.RangoBaremo;

/**
 * Baremo elegido para un puntaje y el rango donde cae. {@code range} es null si el puntaje no cae en ningun rango:
 * el baremo se conserva para dejar trazabilidad de la norma usada.
 */
public record AppliedNorm(Baremo baremo, RangoBaremo range) {
}
