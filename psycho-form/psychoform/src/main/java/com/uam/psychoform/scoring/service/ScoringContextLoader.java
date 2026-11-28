package com.uam.psychoform.scoring.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.assessment.model.OpcionSeleccionadaRespuesta;
import com.uam.psychoform.assessment.model.RespuestaItem;
import com.uam.psychoform.assessment.repository.OpcionSeleccionadaRespuestaRepository;
import com.uam.psychoform.assessment.repository.RespuestaItemRepository;
import com.uam.psychoform.instrument.model.ClaveRespuesta;
import com.uam.psychoform.instrument.model.DimensionResultado;
import com.uam.psychoform.instrument.model.Item;
import com.uam.psychoform.instrument.model.OpcionItem;
import com.uam.psychoform.instrument.model.OpcionPuntajeDimension;
import com.uam.psychoform.instrument.model.ReglaCalificacion;
import com.uam.psychoform.instrument.model.Subtest;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.instrument.repository.ClaveRespuestaLookupRepository;
import com.uam.psychoform.instrument.repository.DimensionResultadoLookupRepository;
import com.uam.psychoform.instrument.repository.ItemLookupRepository;
import com.uam.psychoform.instrument.repository.OpcionItemLookupRepository;
import com.uam.psychoform.instrument.repository.OpcionPuntajeDimensionRepository;
import com.uam.psychoform.instrument.repository.ReglaCalificacionLookupRepository;
import com.uam.psychoform.instrument.repository.SubtestLookupRepository;
import com.uam.psychoform.instrument.repository.VersionTestRepository;
import com.uam.psychoform.scoring.model.RevisionManualRespuesta;
import com.uam.psychoform.scoring.repository.RevisionManualRespuestaRepository;
import com.uam.psychoform.scoring.service.strategy.AnswerKey;
import com.uam.psychoform.scoring.service.strategy.AnswerSnapshot;
import com.uam.psychoform.scoring.service.strategy.AttemptSnapshot;
import com.uam.psychoform.scoring.service.strategy.ManualReviewSnapshot;
import com.uam.psychoform.scoring.service.strategy.ScoringConfiguration;
import com.uam.psychoform.scoring.service.strategy.ScoringContext;
import com.uam.psychoform.security.model.EstadoGeneral;
import jakarta.persistence.EntityNotFoundException;
import java.time.Clock;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Carga, con pocas consultas, los snapshots inmutables que reciben las estrategias: la configuracion de la version
 * ({@link ScoringConfiguration}) y el contexto de un intento ({@link ScoringContext}).
 */
@Component
@Transactional(readOnly = true)
public class ScoringContextLoader {
    private static final ObjectMapper JSON = new ObjectMapper();

    private final VersionTestRepository versions;
    private final SubtestLookupRepository subtests;
    private final ItemLookupRepository items;
    private final OpcionItemLookupRepository options;
    private final ReglaCalificacionLookupRepository rules;
    private final ClaveRespuestaLookupRepository keys;
    private final OpcionPuntajeDimensionRepository matrix;
    private final DimensionResultadoLookupRepository dimensions;
    private final RespuestaItemRepository answers;
    private final OpcionSeleccionadaRespuestaRepository selections;
    private final RevisionManualRespuestaRepository reviews;
    private final Clock clock;

    public ScoringContextLoader(VersionTestRepository versions, SubtestLookupRepository subtests,
            ItemLookupRepository items, OpcionItemLookupRepository options, ReglaCalificacionLookupRepository rules,
            ClaveRespuestaLookupRepository keys, OpcionPuntajeDimensionRepository matrix,
            DimensionResultadoLookupRepository dimensions, RespuestaItemRepository answers,
            OpcionSeleccionadaRespuestaRepository selections, RevisionManualRespuestaRepository reviews,
            Clock clock) {
        this.versions = versions;
        this.subtests = subtests;
        this.items = items;
        this.options = options;
        this.rules = rules;
        this.keys = keys;
        this.matrix = matrix;
        this.dimensions = dimensions;
        this.answers = answers;
        this.selections = selections;
        this.reviews = reviews;
        this.clock = clock;
    }

    /** Configuracion de scoring de la version (solo lo que depende de ella, no del intento). */
    public ScoringConfiguration loadConfiguration(long versionId) {
        VersionTest version = versions.findById(versionId)
                .orElseThrow(() -> new EntityNotFoundException("Version no encontrada: " + versionId));
        String strategyCode = version.getEstrategiaCalificacion() == null ? null
                : version.getEstrategiaCalificacion().getCodigo();

        List<ScoringConfiguration.SubtestInfo> subtestInfos = subtests.findByVersionId(versionId).stream()
                .map(subtest -> new ScoringConfiguration.SubtestInfo(subtest.getId(), subtest.getCodigoSubtest(),
                        subtest.getNombreSubtest(), subtest.getNumeroOrden(),
                        subtest.getEstrategiaCalificacion() == null ? null
                                : subtest.getEstrategiaCalificacion().getCodigo(),
                        subtest.getEstado() == EstadoGeneral.ACTIVO))
                .toList();

        List<Item> activeItems = items.findActiveByVersionId(versionId);
        Map<Long, List<ScoringConfiguration.OptionInfo>> optionsByItem = options.findOfActiveItemsByVersionId(versionId)
                .stream()
                .collect(Collectors.groupingBy(option -> option.getItem().getId(), LinkedHashMap::new,
                        Collectors.mapping(ScoringContextLoader::toOptionInfo, Collectors.toList())));
        List<ScoringConfiguration.ItemInfo> itemInfos = activeItems.stream()
                .map(item -> new ScoringConfiguration.ItemInfo(item.getId(), item.getSubtest().getId(),
                        item.getCodigoItem(), item.getTipoItem(), item.getTipoRespuesta(), item.getPuntajeBase(),
                        item.getNumeroOrden(), Boolean.TRUE.equals(item.getEsObligatorio()),
                        optionsByItem.getOrDefault(item.getId(), List.of())))
                .toList();

        List<ScoringConfiguration.RuleInfo> ruleInfos = rules.findOfficialByVersionId(versionId).stream()
                .map(ScoringContextLoader::toRuleInfo)
                .toList();

        Map<Long, AnswerKey> keysByItem = loadKeys(versionId, activeItems);

        List<ScoringConfiguration.DimensionInfo> dimensionInfos = dimensions.findActiveByVersionId(versionId).stream()
                .map(ScoringContextLoader::toDimensionInfo)
                .toList();
        Set<Long> activeDimensionIds = dimensionInfos.stream().map(ScoringConfiguration.DimensionInfo::id)
                .collect(Collectors.toSet());
        // Una fila de matriz hacia una dimension desactivada no aporta puntaje.
        List<ScoringConfiguration.MatrixRow> matrixRows = matrix.findActiveOfficialByVersionId(versionId).stream()
                .filter(row -> activeDimensionIds.contains(row.getDimensionResultado().getId()))
                .map(ScoringContextLoader::toMatrixRow)
                .toList();

        return new ScoringConfiguration(versionId, strategyCode, subtestInfos, itemInfos, ruleInfos, keysByItem,
                matrixRows, dimensionInfos);
    }

    /** Contexto completo de un intento: configuracion de su version, perfil normativo y respuestas. */
    public ScoringContext load(IntentoTest intento) {
        long versionId = intento.getAsignacion().getSesionAplicacion().getVersionTest().getId();
        ScoringConfiguration configuration = loadConfiguration(versionId);

        List<RespuestaItem> attemptAnswers = answers.findByIntentoIdWithItem(intento.getId());
        List<Long> answerIds = attemptAnswers.stream().map(RespuestaItem::getId).toList();
        Map<Long, List<OpcionSeleccionadaRespuesta>> selectionsByAnswer = answerIds.isEmpty() ? Map.of()
                : selections.findByRespuestaIdIn(answerIds).stream()
                        .collect(Collectors.groupingBy(selection -> selection.getRespuesta().getId()));
        Map<Long, RevisionManualRespuesta> reviewsByAnswer = answerIds.isEmpty() ? Map.of()
                : reviews.findByRespuestaIdIn(answerIds).stream()
                        .collect(Collectors.toMap(review -> review.getRespuesta().getId(), review -> review,
                                (first, second) -> first));

        Map<Long, AnswerSnapshot> answersByItem = new LinkedHashMap<>();
        for (RespuestaItem answer : attemptAnswers) {
            List<OpcionItem> selectedOptions = selectionsByAnswer.getOrDefault(answer.getId(), List.of()).stream()
                    .map(OpcionSeleccionadaRespuesta::getOpcion)
                    .sorted(Comparator.comparing(OpcionItem::getId))
                    .toList();
            RevisionManualRespuesta review = reviewsByAnswer.get(answer.getId());
            answersByItem.putIfAbsent(answer.getItem().getId(), new AnswerSnapshot(answer.getId(),
                    answer.getItem().getId(),
                    selectedOptions.stream().map(OpcionItem::getId).toList(),
                    selectedOptions.stream().map(OpcionItem::getCodigoOpcion).toList(),
                    answer.getRespuestaTextoAbierto(), answer.getRespuestaNumerica(), answer.getTiempoUsadoSegundos(),
                    Boolean.TRUE.equals(answer.getRequiereRevisionManual()),
                    review == null ? null : new ManualReviewSnapshot(review.getId(), review.getEstado(),
                            review.getPuntajeAsignado())));
        }
        AttemptSnapshot attempt = new AttemptSnapshot(intento.getId(), intento.getIniciadoEn(),
                intento.getFinalizadoEn(), NormativeProfiles.of(intento, clock), answersByItem);
        return new ScoringContext(configuration, attempt);
    }

    private Map<Long, AnswerKey> loadKeys(long versionId, List<Item> activeItems) {
        Set<Long> activeItemIds = activeItems.stream().map(Item::getId).collect(Collectors.toSet());
        Map<Long, List<ClaveRespuesta>> keysByItem = keys.findOfficialKeysByVersionId(versionId).stream()
                .filter(key -> activeItemIds.contains(key.getItem().getId()))
                .collect(Collectors.groupingBy(key -> key.getItem().getId(), LinkedHashMap::new,
                        Collectors.toList()));
        keysByItem.forEach((itemId, itemKeys) -> {
            if (itemKeys.size() > 1) {
                throw new IllegalStateException("El item " + itemKeys.getFirst().getItem().getCodigoItem()
                        + " tiene mas de una clave de respuesta oficial");
            }
        });
        List<Long> keyIds = keysByItem.values().stream().flatMap(List::stream).map(ClaveRespuesta::getId).toList();
        Map<Long, Set<Long>> optionSets = keyIds.isEmpty() ? Map.of()
                : ClaveCorrectnessEvaluator.groupOptionSetRows(keys.findOptionSetRowsByKeyIds(keyIds));
        Map<Long, AnswerKey> result = new LinkedHashMap<>();
        keysByItem.forEach((itemId, itemKeys) -> {
            ClaveRespuesta key = itemKeys.getFirst();
            result.put(itemId, new AnswerKey(key.getId(), key.getReglaCalificacion().getId(), itemId,
                    key.getOpcionCorrecta() == null ? null : key.getOpcionCorrecta().getId(), key.getTextoEsperado(),
                    key.getValorNumericoEsperado(), key.getToleranciaNumerica(), key.getPuntaje(),
                    Boolean.TRUE.equals(key.getRequiereRevisionManual()),
                    optionSets.getOrDefault(key.getId(), Set.of())));
        });
        return result;
    }

    private static ScoringConfiguration.OptionInfo toOptionInfo(OpcionItem option) {
        return new ScoringConfiguration.OptionInfo(option.getId(), option.getCodigoOpcion(), option.getNumeroOrden(),
                option.getValorOrdinal(), option.getEstado() == EstadoGeneral.ACTIVO);
    }

    private static ScoringConfiguration.RuleInfo toRuleInfo(ReglaCalificacion rule) {
        return new ScoringConfiguration.RuleInfo(rule.getId(),
                rule.getSubtest() == null ? null : rule.getSubtest().getId(),
                rule.getItem() == null ? null : rule.getItem().getId(), rule.getTipoRegla(), rule.getPrioridad(),
                parseParameters(rule));
    }

    private static JsonNode parseParameters(ReglaCalificacion rule) {
        String raw = rule.getParametros();
        if (raw == null || raw.isBlank()) {
            return JSON.createObjectNode();
        }
        try {
            return JSON.readTree(raw);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("La regla " + rule.getId() + " tiene parametros JSON invalidos",
                    exception);
        }
    }

    private static ScoringConfiguration.MatrixRow toMatrixRow(OpcionPuntajeDimension row) {
        return new ScoringConfiguration.MatrixRow(row.getOpcion().getId(), row.getDimensionResultado().getId(),
                row.getReglaCalificacion().getId(), row.getPuntaje(), row.getPeso());
    }

    private static ScoringConfiguration.DimensionInfo toDimensionInfo(DimensionResultado dimension) {
        Subtest subtest = dimension.getSubtest();
        return new ScoringConfiguration.DimensionInfo(dimension.getId(), dimension.getCodigoDimension(),
                dimension.getNombreDimension(), subtest == null ? null : subtest.getId(),
                dimension.getOrdenPresentacion(), dimension.getPuntajeMinimo(), dimension.getPuntajeMaximo());
    }
}
