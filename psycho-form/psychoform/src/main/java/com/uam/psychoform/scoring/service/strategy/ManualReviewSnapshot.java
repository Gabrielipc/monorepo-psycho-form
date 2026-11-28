package com.uam.psychoform.scoring.service.strategy;

import com.uam.psychoform.scoring.model.EstadoRevisionManual;
import java.math.BigDecimal;

/** Revision manual guardada de una respuesta. */
public record ManualReviewSnapshot(long reviewId, EstadoRevisionManual status, BigDecimal assignedScore) {
    /** Una revision resuelta es REVISADO con puntaje asignado. */
    public boolean isResolved() {
        return status == EstadoRevisionManual.REVISADO && assignedScore != null;
    }
}
