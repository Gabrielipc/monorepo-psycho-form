package com.uam.psychoform.scoring.service.strategy;

import com.uam.psychoform.scoring.service.ClaveCorrectnessEvaluator;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Califica items contra su clave oficial (la logica de CLAVE_SIMPLE). Es una utilidad pura y sin estado que otras
 * estrategias pueden reutilizar: "califica cada item como CLAVE_SIMPLE y luego aplica mi formula".
 * <p>
 * Un item con revision manual (por su clave o porque la respuesta se marco) no se autocalifica: queda en 0 y pendiente
 * hasta que su revision este REVISADO con puntaje asignado, momento en que aporta ese puntaje. Las respuestas de items
 * sin clave se ignoran.
 */
public final class KeyedItemGrader {
    private KeyedItemGrader() {
    }

    /**
     * Calificacion de un item.
     *
     * @param manualReview si el item pasa por revision manual (pendiente o ya resuelta)
     */
    public record GradedItem(ScoringConfiguration.ItemInfo item, AnswerSnapshot answer, AnswerKey key,
            ItemScore score, boolean manualReview) {
    }

    /** Califica todas las respuestas de items activos que tienen clave, en el orden de los items. */
    public static List<GradedItem> gradeAll(ScoringContext context) {
        List<GradedItem> graded = new ArrayList<>();
        for (ScoringConfiguration.ItemInfo item : context.configuration().items()) {
            context.answer(item.id())
                    .flatMap(answer -> grade(context.configuration(), item, answer))
                    .ifPresent(graded::add);
        }
        return graded;
    }

    /** Califica una respuesta; vacio si el item no tiene clave oficial. */
    public static Optional<GradedItem> grade(ScoringConfiguration configuration, ScoringConfiguration.ItemInfo item,
            AnswerSnapshot answer) {
        AnswerKey key = configuration.keysByItem().get(item.id());
        if (key == null) {
            return Optional.empty();
        }
        boolean manual = key.requiresManualReview() || answer.flaggedForManualReview();
        ManualReviewSnapshot review = answer.review();
        boolean resolved = manual && review != null && review.isResolved();
        boolean pending = manual && !resolved;
        boolean correct;
        BigDecimal score;
        if (resolved) {
            score = review.assignedScore();
            correct = score.signum() > 0;
        } else if (manual) {
            score = BigDecimal.ZERO;
            correct = false;
        } else {
            correct = ClaveCorrectnessEvaluator.isCorrect(item.answerType(), key, answer);
            score = correct ? key.score() : BigDecimal.ZERO;
        }
        ItemScore itemScore = new ItemScore(answer.answerId(), item.id(), key.ruleId(), key.correctOptionId(), score,
                correct, pending, null, null);
        return Optional.of(new GradedItem(item, answer, key, itemScore, manual));
    }
}
