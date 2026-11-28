package com.uam.psychoform.scoring.service.strategy;

import java.math.BigDecimal;

/**
 * Calificacion de una respuesta ({@code calificacion_respuesta}).
 *
 * @param answerId respuesta calificada (obligatoria)
 * @param itemId item de la respuesta
 * @param ruleId regla aplicada (opcional, debe pertenecer a la configuracion)
 * @param optionId opcion asociada (opcional, debe pertenecer a la configuracion)
 * @param score puntaje obtenido (no nulo)
 * @param correct acierto o null si no aplica
 * @param pendingManualReview si queda pendiente de revision manual
 * @param dimensionId dimension asociada (opcional)
 * @param note observacion (opcional)
 */
public record ItemScore(long answerId, long itemId, Long ruleId, Long optionId, BigDecimal score, Boolean correct,
        boolean pendingManualReview, Long dimensionId, String note) {
}
