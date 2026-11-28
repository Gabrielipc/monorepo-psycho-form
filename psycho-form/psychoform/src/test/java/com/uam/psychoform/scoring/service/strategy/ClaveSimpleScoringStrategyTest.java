package com.uam.psychoform.scoring.service.strategy;

import static org.assertj.core.api.Assertions.assertThat;

import com.uam.psychoform.instrument.model.TipoEstrategiaCalificacion;
import com.uam.psychoform.instrument.model.TipoRespuesta;
import com.uam.psychoform.scoring.model.EstadoRevisionManual;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** Pruebas puras (sin Mockito ni BD) de CLAVE_SIMPLE sobre snapshots. */
class ClaveSimpleScoringStrategyTest {
    private final ClaveSimpleScoringStrategy strategy = new ClaveSimpleScoringStrategy();

    private static ScoringContextBuilder base() {
        return ScoringContextBuilder.forVersion(100L, "CLAVE_SIMPLE").subtest(5L, "FI");
    }

    private static ItemScore only(ScoringOutcome outcome) {
        assertThat(outcome.items()).hasSize(1);
        return outcome.items().getFirst();
    }

    @Test
    void descriptorYCodigoCoinciden() {
        assertThat(strategy.code()).isEqualTo("CLAVE_SIMPLE");
        assertThat(strategy.descriptor().code()).isEqualTo(strategy.code());
        assertThat(strategy.descriptor().type()).isEqualTo(TipoEstrategiaCalificacion.CLAVE_SIMPLE);
        assertThat(strategy.descriptor().allowsBaremo()).isTrue();
        assertThat(strategy.descriptor().requiresManualReview()).isFalse();
    }

    // ---- correccion por tipo de respuesta ----

    @Test
    void opcionUnicaCorrectaEIncorrecta() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA)
                .option(10L, 1L, "A").option(10L, 2L, "B").keyForOption(10L, 1L, "2.00");

        ScoringOutcome right = strategy.score(b.answerOptions(10L, 500L, 1L).context());
        assertThat(only(right).correct()).isTrue();
        assertThat(only(right).score()).isEqualByComparingTo("2.00");
        assertThat(only(right).ruleId()).isEqualTo(ScoringContextBuilder.DEFAULT_RULE_ID);
        assertThat(only(right).optionId()).isEqualTo(1L);
        assertThat(only(right).answerId()).isEqualTo(500L);

        ScoringOutcome wrong = strategy.score(b.answerOptions(10L, 500L, 2L).context());
        assertThat(only(wrong).correct()).isFalse();
        assertThat(only(wrong).score()).isEqualByComparingTo("0");
        assertThat(wrong.totalDirectScore()).isEqualByComparingTo("0");
    }

    @Test
    void verdaderoFalsoSeCorrigePorOpcionCorrecta() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.VERDADERO_FALSO)
                .option(10L, 1L, "V").option(10L, 2L, "F").keyForOption(10L, 2L, "1.00");

        assertThat(only(strategy.score(b.answerOptions(10L, 500L, 2L).context())).correct()).isTrue();
        assertThat(only(strategy.score(b.answerOptions(10L, 500L, 1L).context())).correct()).isFalse();
    }

    @Test
    void numericaEsCorrectaHastaElBordeDeLaTolerancia() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.NUMERICA)
                .keyNumeric(10L, "10.0000", "0.5000", "5.00");

        assertThat(only(strategy.score(b.answerNumber(10L, 500L, "10.5").context())).score()).isEqualByComparingTo("5.00");
        assertThat(only(strategy.score(b.answerNumber(10L, 500L, "9.5").context())).score()).isEqualByComparingTo("5.00");
        assertThat(only(strategy.score(b.answerNumber(10L, 500L, "10.5001").context())).correct()).isFalse();
        assertThat(only(strategy.score(b.answerNumber(10L, 500L, null).context())).correct()).isFalse();
    }

    @Test
    void numericaSinToleranciaExigeValorExacto() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.NUMERICA)
                .keyNumeric(10L, "3.0000", null, "1.00");

        assertThat(only(strategy.score(b.answerNumber(10L, 500L, "3.00").context())).correct()).isTrue();
        assertThat(only(strategy.score(b.answerNumber(10L, 500L, "3.01").context())).correct()).isFalse();
    }

    @Test
    void textoAbiertoSeComparaNormalizadoSinRevisionManual() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.TEXTO_ABIERTO)
                .keyText(10L, "  Árbol   de la Vida ", "4.00");

        ItemScore right = only(strategy.score(b.answerText(10L, 500L, "arbol DE   la vida").context()));
        assertThat(right.score()).isEqualByComparingTo("4.00");
        assertThat(right.pendingManualReview()).isFalse();
        assertThat(only(strategy.score(b.answerText(10L, 500L, "arbol de vida").context())).correct()).isFalse();
        assertThat(only(strategy.score(b.answerText(10L, 500L, null).context())).correct()).isFalse();
    }

    @Test
    void opcionMultipleConCodigosEsperadosEsCorrectaSoloConConjuntoIgual() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.OPCION_MULTIPLE)
                .option(10L, 1L, "A").option(10L, 2L, "B").option(10L, 3L, "C")
                .keyCodes(10L, " b, a ,A,", "3.00");

        assertThat(only(strategy.score(b.answerOptions(10L, 500L, 1L, 2L).context())).score())
                .isEqualByComparingTo("3.00");
        assertThat(only(strategy.score(b.answerOptions(10L, 500L, 1L).context())).correct()).isFalse();
        assertThat(only(strategy.score(b.answerOptions(10L, 500L, 1L, 2L, 3L).context())).correct()).isFalse();
        assertThat(only(strategy.score(b.answerOptions(10L, 500L).context())).correct()).isFalse();
    }

    @Test
    void opcionMultiplePorConjuntoUsaLosIdsDeOpcion() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.OPCION_MULTIPLE)
                .option(10L, 1L, "A").option(10L, 2L, "B").option(10L, 3L, "C")
                .keyOptionSet(10L, "2.00", 1L, 2L);

        assertThat(only(strategy.score(b.answerOptions(10L, 500L, 2L, 1L).context())).score())
                .isEqualByComparingTo("2.00");
        assertThat(only(strategy.score(b.answerOptions(10L, 500L, 1L).context())).correct()).isFalse();
        assertThat(only(strategy.score(b.answerOptions(10L, 500L, 1L, 2L, 3L).context())).correct()).isFalse();
    }

    // ---- revision manual ----

    @Test
    void itemConRevisionManualNoSeAutocalificaYQuedaPendiente() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.TEXTO_ABIERTO)
                .keyManual(10L, "4.00").answerText(10L, 500L, "hola");

        ScoringOutcome outcome = strategy.score(b.context());

        ItemScore item = only(outcome);
        assertThat(item.pendingManualReview()).isTrue();
        assertThat(item.correct()).isFalse();
        assertThat(item.score()).isEqualByComparingTo("0");
        assertThat(outcome.totalDirectScore()).isEqualByComparingTo("0");
    }

    @Test
    void respuestaMarcadaParaRevisionQuedaPendienteAunqueLaClaveNoLaPida() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA)
                .option(10L, 1L, "A").keyForOption(10L, 1L, "1.00")
                .answerOptions(10L, 500L, 1L).flagForManualReview(10L);

        ItemScore item = only(strategy.score(b.context()));

        assertThat(item.pendingManualReview()).isTrue();
        assertThat(item.score()).isEqualByComparingTo("0");
    }

    @Test
    void revisionResueltaAplicaElPuntajeAsignadoYNoQuedaPendiente() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.TEXTO_ABIERTO)
                .keyManual(10L, "5.00").answerText(10L, 500L, "x")
                .review(10L, EstadoRevisionManual.REVISADO, "4.50");

        ScoringOutcome outcome = strategy.score(b.context());

        assertThat(only(outcome).pendingManualReview()).isFalse();
        assertThat(only(outcome).correct()).isTrue();
        assertThat(only(outcome).score()).isEqualByComparingTo("4.50");
        assertThat(outcome.totalDirectScore()).isEqualByComparingTo("4.50");
    }

    @Test
    void revisionRevisadaConPuntajeCeroEsIncorrectaYNoPendiente() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.TEXTO_ABIERTO)
                .keyManual(10L, "5.00").answerText(10L, 500L, "x")
                .review(10L, EstadoRevisionManual.REVISADO, "0");

        ItemScore item = only(strategy.score(b.context()));

        assertThat(item.pendingManualReview()).isFalse();
        assertThat(item.correct()).isFalse();
    }

    @Test
    void revisionObservadaSigueComoPendienteConPuntajeCero() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.TEXTO_ABIERTO)
                .keyManual(10L, "5.00").answerText(10L, 500L, "x")
                .review(10L, EstadoRevisionManual.OBSERVADO, "3.00");

        ItemScore item = only(strategy.score(b.context()));

        assertThat(item.pendingManualReview()).isTrue();
        assertThat(item.score()).isEqualByComparingTo("0");
    }

    // ---- dimensiones ----

    @Test
    void itemConMatrizSumaPuntajePorPesoDeLasOpcionesSeleccionadas() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.OPCION_MULTIPLE)
                .option(10L, 1L, "A").option(10L, 2L, "B").option(10L, 3L, "C")
                .keyOptionSet(10L, "1.00", 1L, 2L)
                .dimension(60L, "D1", 5L, 1).dimension(61L, "D2", null, 2)
                .matrix(1L, 60L, "2.00", "1.5000").matrix(2L, 61L, "1.00", "1.0000").matrix(3L, 60L, "9.00", "1.0000")
                .answerOptions(10L, 500L, 1L, 2L);

        ScoringOutcome outcome = strategy.score(b.context());

        assertThat(outcome.dimensions()).hasSize(2);
        assertThat(score(outcome, 60L)).isEqualByComparingTo("3.00");
        assertThat(score(outcome, 61L)).isEqualByComparingTo("1.00");
        // con matriz no se suma el puntaje de la clave a la dimension del subtest
        assertThat(outcome.totalDirectScore()).isEqualByComparingTo("1.00");
    }

    @Test
    void itemAutomaticoSinMatrizSumaSuPuntajeALaDimensionDelSubtest() {
        ScoringContextBuilder b = base().subtest(6L, "FJ")
                .item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA).option(10L, 1L, "A").option(10L, 2L, "B")
                .item(11L, 5L, "FI-02", TipoRespuesta.OPCION_UNICA).option(11L, 3L, "A").option(11L, 4L, "B")
                .item(12L, 6L, "FJ-01", TipoRespuesta.OPCION_UNICA).option(12L, 5L, "A").option(12L, 6L, "B")
                .keyForOption(10L, 1L, "2.00").keyForOption(11L, 3L, "1.50").keyForOption(12L, 5L, "1.00")
                .dimension(60L, "FI", 5L, 1).dimension(61L, "FJ", 6L, 2)
                .answerOptions(10L, 500L, 1L).answerOptions(11L, 501L, 3L).answerOptions(12L, 502L, 6L);

        ScoringOutcome outcome = strategy.score(b.context());

        assertThat(score(outcome, 60L)).isEqualByComparingTo("3.50");
        // un item incorrecto aporta 0 a su escala: la dimension aparece con 0
        assertThat(score(outcome, 61L)).isEqualByComparingTo("0");
        assertThat(outcome.totalDirectScore()).isEqualByComparingTo("3.50");
    }

    @Test
    void sinDimensionDeSubtestNoSeEmitenDimensiones() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA).option(10L, 1L, "A")
                .keyForOption(10L, 1L, "2.00").answerOptions(10L, 500L, 1L);

        assertThat(strategy.score(b.context()).dimensions()).isEmpty();
    }

    @Test
    void itemManualAportaSuPuntajeALaDimensionDelSubtestEnVezDeLaMatriz() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA).option(10L, 1L, "A")
                .keyManual(10L, "5.00").dimension(60L, "FI", 5L, 1).matrix(1L, 60L, "4.00", "1.0000")
                .answerOptions(10L, 500L, 1L);

        // pendiente: la dimension aparece con 0 y no con la matriz
        assertThat(score(strategy.score(b.context()), 60L)).isEqualByComparingTo("0");
        // resuelta: aporta el puntaje asignado
        ScoringOutcome resolved = strategy.score(b.review(10L, EstadoRevisionManual.REVISADO, "2.00").context());
        assertThat(score(resolved, 60L)).isEqualByComparingTo("2.00");
    }

    @Test
    void dimensionDelSubtestEsLaPrimeraPorOrdenDePresentacion() {
        ScoringContextBuilder b = base().item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA).option(10L, 1L, "A")
                .keyForOption(10L, 1L, "2.00").dimension(61L, "SEGUNDA", 5L, 2).dimension(60L, "PRIMERA", 5L, 1)
                .answerOptions(10L, 500L, 1L);

        ScoringOutcome outcome = strategy.score(b.context());

        assertThat(outcome.dimensions()).singleElement().satisfies(d -> assertThat(d.dimensionId()).isEqualTo(60L));
    }

    // ---- items sin clave y totales ----

    @Test
    void respuestaDeItemSinClaveSeIgnora() {
        ScoringContextBuilder b = base()
                .item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA).option(10L, 1L, "A").keyForOption(10L, 1L, "2.00")
                .item(11L, 5L, "FI-02", TipoRespuesta.OPCION_UNICA).option(11L, 2L, "A")
                .answerOptions(10L, 500L, 1L).answerOptions(11L, 501L, 2L);

        ScoringOutcome outcome = strategy.score(b.context());

        assertThat(outcome.items()).extracting(ItemScore::itemId).containsExactly(10L);
    }

    @Test
    void itemOmitidoNoGeneraFilaYElTotalSumaLosScoresDeLosItemsCalificados() {
        ScoringContextBuilder b = base()
                .item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA).option(10L, 1L, "A").keyForOption(10L, 1L, "2.00")
                .item(11L, 5L, "FI-02", TipoRespuesta.OPCION_UNICA).option(11L, 2L, "A").keyForOption(11L, 2L, "1.25")
                .item(12L, 5L, "FI-03", TipoRespuesta.OPCION_UNICA).option(12L, 3L, "A").keyForOption(12L, 3L, "7.00")
                .answerOptions(10L, 500L, 1L).answerOptions(11L, 501L, 2L);

        ScoringOutcome outcome = strategy.score(b.context());

        assertThat(outcome.items()).hasSize(2);
        assertThat(outcome.totalDirectScore()).isEqualByComparingTo("3.25");
        assertThat(b.context().unansweredItems()).extracting(ScoringConfiguration.ItemInfo::id).containsExactly(12L);
        assertThat(b.context().answeredItems()).extracting(ScoringConfiguration.ItemInfo::id)
                .containsExactly(10L, 11L);
    }

    // ---- validateConfiguration ----

    @Test
    void validarVersionSinItemsEsProblema() {
        assertThat(strategy.validateConfiguration(base().configuration())).singleElement()
                .asString().contains("items activos");
    }

    @Test
    void validarInformaLosItemsSinClavePorSubtest() {
        ScoringContextBuilder b = base().subtest(6L, "FJ")
                .item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA).option(10L, 1L, "A").keyForOption(10L, 1L, "1.00")
                .item(11L, 5L, "FI-03", TipoRespuesta.OPCION_UNICA).option(11L, 2L, "A")
                .item(12L, 6L, "FJ-01", TipoRespuesta.OPCION_UNICA).option(12L, 3L, "A")
                .item(13L, 6L, "FJ-02", TipoRespuesta.OPCION_UNICA).option(13L, 4L, "A");

        List<String> problems = strategy.validateConfiguration(b.configuration());

        assertThat(problems).containsExactly(
                "Subtest FI: el item FI-03 no tiene clave de respuesta",
                "Subtest FJ: los items FJ-01, FJ-02 no tienen clave de respuesta");
    }

    @Test
    void validarDetectaClavesIncoherentesConElTipoDeRespuesta() {
        ScoringContextBuilder b = base()
                .item(10L, 5L, "N-1", TipoRespuesta.NUMERICA).keyText(10L, "x", "1.00")
                .item(11L, 5L, "T-1", TipoRespuesta.TEXTO_ABIERTO).keyForOption(11L, 7L, "1.00")
                .item(12L, 5L, "M-1", TipoRespuesta.OPCION_MULTIPLE).keyNumeric(12L, "1", null, "1.00")
                .item(13L, 5L, "U-1", TipoRespuesta.OPCION_UNICA).keyText(13L, "x", "1.00")
                .item(14L, 5L, "V-1", TipoRespuesta.VERDADERO_FALSO).keyText(14L, "x", "1.00");

        List<String> problems = strategy.validateConfiguration(b.configuration());

        assertThat(problems).hasSize(5);
        assertThat(problems.get(0)).contains("Subtest FI", "N-1", "valor numerico esperado");
        assertThat(problems.get(1)).contains("T-1", "texto esperado");
        assertThat(problems.get(2)).contains("M-1", "opciones correctas");
        assertThat(problems.get(3)).contains("U-1", "opcion correcta");
        assertThat(problems.get(4)).contains("V-1", "opcion correcta");
    }

    @Test
    void validarAceptaClavesCoherentesYLasDeRevisionManual() {
        ScoringContextBuilder b = base()
                .item(10L, 5L, "N-1", TipoRespuesta.NUMERICA).keyNumeric(10L, "1", null, "1.00")
                .item(11L, 5L, "T-1", TipoRespuesta.TEXTO_ABIERTO).keyManual(11L, "5.00")
                .item(12L, 5L, "M-1", TipoRespuesta.OPCION_MULTIPLE).keyCodes(12L, "A,B", "1.00")
                .item(13L, 5L, "M-2", TipoRespuesta.OPCION_MULTIPLE).keyOptionSet(13L, "1.00", 1L, 2L)
                .item(14L, 5L, "U-1", TipoRespuesta.OPCION_UNICA).option(14L, 9L, "A").keyForOption(14L, 9L, "1.00");

        assertThat(strategy.validateConfiguration(b.configuration())).isEmpty();
    }

    @Test
    void configuracionExponeHelpersDeReglasYSubtests() {
        ScoringConfiguration config = base().subtest(6L, "FJ")
                .item(10L, 5L, "FI-01", TipoRespuesta.OPCION_UNICA).option(10L, 1L, "A")
                .item(11L, 6L, "FJ-01", TipoRespuesta.OPCION_UNICA)
                .rule(2L, null, null, com.uam.psychoform.instrument.model.TipoReglaCalificacion.CLAVE_ITEM, 1, "{\"k\":1}")
                .rule(3L, 5L, null, com.uam.psychoform.instrument.model.TipoReglaCalificacion.CLAVE_ITEM, 1, null)
                .rule(4L, 5L, 10L, com.uam.psychoform.instrument.model.TipoReglaCalificacion.CLAVE_ITEM, 2, null)
                .rule(5L, 5L, 10L, com.uam.psychoform.instrument.model.TipoReglaCalificacion.CLAVE_ITEM, 1, null)
                .matrix(1L, 60L, "1", "1").dimension(60L, "D", 5L, 1)
                .configuration();

        assertThat(config.itemsOfSubtest(5L)).extracting(ScoringConfiguration.ItemInfo::id).containsExactly(10L);
        assertThat(config.item(11L)).isPresent();
        assertThat(config.item(99L)).isEqualTo(Optional.empty());
        assertThat(config.rulesForItem(10L)).extracting(ScoringConfiguration.RuleInfo::id)
                .containsExactly(5L, 4L, 3L, 2L, ScoringContextBuilder.DEFAULT_RULE_ID);
        assertThat(config.rule(2L).orElseThrow().parameters().get("k").asInt()).isEqualTo(1);
        assertThat(config.itemHasMatrix(10L)).isTrue();
        assertThat(config.itemHasMatrix(11L)).isFalse();
        assertThat(config.matrixForOption(1L)).hasSize(1);
        assertThat(config.dimensionOfSubtest(5L)).isPresent();
        assertThat(config.dimensionOfSubtest(6L)).isEmpty();
    }

    private static java.math.BigDecimal score(ScoringOutcome outcome, long dimensionId) {
        return outcome.dimensions().stream().filter(d -> d.dimensionId() == dimensionId).findFirst()
                .orElseThrow().directScore();
    }
}
