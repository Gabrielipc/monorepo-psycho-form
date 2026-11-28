package com.uam.psychoform.instrument.service;

import com.uam.psychoform.instrument.dto.DimensionDTO;
import com.uam.psychoform.instrument.dto.OptionScoreDTO;
import com.uam.psychoform.instrument.model.DimensionResultado;
import com.uam.psychoform.instrument.model.EstadoVersionTest;
import com.uam.psychoform.instrument.model.OpcionItem;
import com.uam.psychoform.instrument.model.OpcionPuntajeDimension;
import com.uam.psychoform.instrument.model.ReglaCalificacion;
import com.uam.psychoform.instrument.model.Subtest;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.instrument.repository.VersionTestRepository;
import com.uam.psychoform.security.SecurityPermissions;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Administracion de las dimensiones de resultado (escalas) y de la matriz opcion-dimension de una version.
 * Toda escritura exige version en BORRADOR y replica antes las validaciones de la base de datos
 * ({@code tg_bfa_validar_matriz_alcance}, unicidad de codigo y orden) para devolver mensajes claros.
 */
@Service
@Transactional(readOnly = true)
public class ScoringDimensionAdminService {
    private final EntityManager em;
    private final VersionTestRepository versions;
    private final Clock clock;

    public ScoringDimensionAdminService(EntityManager em, VersionTestRepository versions, Clock clock) {
        this.em = em;
        this.versions = versions;
        this.clock = clock;
    }

    @PreAuthorize(SecurityPermissions.CALIFICACION_CONFIGURAR + " or " + SecurityPermissions.TEST_LEER)
    public List<DimensionDTO> listDimensions(long versionId) {
        find(VersionTest.class, versionId);
        return dimensionsOfVersion(versionId).stream().map(DimensionDTO::from).toList();
    }

    @Transactional
    @PreAuthorize(SecurityPermissions.CALIFICACION_CONFIGURAR)
    public DimensionDTO createDimension(long versionId, DimensionCommand command) {
        VersionTest version = requireDraft(versionId);
        if (isBlank(command.code()) || isBlank(command.name()) || command.order() == null) {
            throw new IllegalArgumentException("code, name y order son obligatorios");
        }
        List<DimensionResultado> existing = dimensionsOfVersion(versionId);
        assertUnique(existing, command.code(), command.order(), null);
        Subtest subtest = resolveSubtest(version, command.subtestId());
        assertRange(command.minScore(), command.maxScore());
        DimensionResultado dimension = new DimensionResultado();
        dimension.setVersionTest(version);
        dimension.setSubtest(subtest);
        dimension.setCodigoDimension(command.code());
        dimension.setNombreDimension(command.name());
        dimension.setDescripcion(command.description());
        dimension.setOrdenPresentacion(command.order());
        dimension.setPuntajeMinimo(command.minScore());
        dimension.setPuntajeMaximo(command.maxScore());
        dimension.setActiva(command.active() == null || command.active());
        dimension.setCreadoEn(LocalDateTime.now(clock));
        em.persist(dimension);
        return DimensionDTO.from(dimension);
    }

    /** Edicion parcial: los campos nulos del comando no cambian el valor actual. */
    @Transactional
    @PreAuthorize(SecurityPermissions.CALIFICACION_CONFIGURAR)
    public DimensionDTO updateDimension(long dimensionId, DimensionCommand command) {
        DimensionResultado dimension = find(DimensionResultado.class, dimensionId);
        VersionTest version = requireDraft(dimension.getVersionTest().getId());
        if (command.code() != null && isBlank(command.code())) {
            throw new IllegalArgumentException("code no puede estar en blanco");
        }
        if (command.name() != null && isBlank(command.name())) {
            throw new IllegalArgumentException("name no puede estar en blanco");
        }
        String code = command.code() == null ? dimension.getCodigoDimension() : command.code();
        Integer order = command.order() == null ? dimension.getOrdenPresentacion() : command.order();
        assertUnique(dimensionsOfVersion(version.getId()), code, order, dimension.getId());
        BigDecimal min = command.minScore() == null ? dimension.getPuntajeMinimo() : command.minScore();
        BigDecimal max = command.maxScore() == null ? dimension.getPuntajeMaximo() : command.maxScore();
        assertRange(min, max);
        if (command.subtestId() != null) {
            dimension.setSubtest(resolveSubtest(version, command.subtestId()));
        }
        dimension.setCodigoDimension(code);
        if (command.name() != null) {
            dimension.setNombreDimension(command.name());
        }
        if (command.description() != null) {
            dimension.setDescripcion(command.description());
        }
        dimension.setOrdenPresentacion(order);
        dimension.setPuntajeMinimo(min);
        dimension.setPuntajeMaximo(max);
        if (command.active() != null) {
            dimension.setActiva(command.active());
        }
        return DimensionDTO.from(dimension);
    }

    /**
     * Elimina la dimension solo si nada la referencia. La FK de baremo es ON DELETE CASCADE, de modo que esta
     * validacion evita borrar baremos en silencio.
     */
    @Transactional
    @PreAuthorize(SecurityPermissions.CALIFICACION_CONFIGURAR)
    public void deleteDimension(long dimensionId) {
        DimensionResultado dimension = find(DimensionResultado.class, dimensionId);
        requireDraft(dimension.getVersionTest().getId());
        List<String> references = new ArrayList<>();
        addReference(references, "baremo(s)",
                "select count(b) from Baremo b where b.dimensionResultado.id = :id", dimensionId);
        addReference(references, "fila(s) de la matriz opcion-dimension",
                "select count(o) from OpcionPuntajeDimension o where o.dimensionResultado.id = :id", dimensionId);
        addReference(references, "calificacion(es) de respuesta",
                "select count(c) from CalificacionRespuesta c where c.dimensionResultado.id = :id", dimensionId);
        addReference(references, "resultado(s) de dimension",
                "select count(r) from ResultadoDimension r where r.dimensionResultado.id = :id", dimensionId);
        if (!references.isEmpty()) {
            throw new IllegalStateException("La dimension " + dimension.getCodigoDimension()
                    + " esta referenciada por " + String.join(", ", references)
                    + "; desactivela (active=false) en lugar de eliminarla");
        }
        em.remove(dimension);
    }

    @PreAuthorize(SecurityPermissions.CALIFICACION_CONFIGURAR + " or " + SecurityPermissions.TEST_LEER)
    public List<OptionScoreDTO> listOptionScores(long ruleId) {
        find(ReglaCalificacion.class, ruleId);
        return rowsOfRule(ruleId).stream().map(OptionScoreDTO::from).toList();
    }

    /** Reemplaza en una transaccion el conjunto completo de filas de matriz de la regla. */
    @Transactional
    @PreAuthorize(SecurityPermissions.CALIFICACION_CONFIGURAR)
    public List<OptionScoreDTO> replaceOptionScores(long ruleId, List<OptionScoreRow> rows) {
        ReglaCalificacion rule = find(ReglaCalificacion.class, ruleId);
        requireDraft(rule.getVersionTest().getId());
        List<OptionScoreRow> requested = rows == null ? List.of() : rows;
        validateRows(requested);
        Map<Long, OpcionItem> options = loadOptions(requested);
        Map<Long, DimensionResultado> dimensions = loadDimensions(requested);
        for (OptionScoreRow row : requested) {
            assertOptionInScope(rule, options.get(row.optionId()));
            DimensionResultado dimension = dimensions.get(row.dimensionId());
            if (dimension == null || !dimension.getVersionTest().getId().equals(rule.getVersionTest().getId())) {
                throw new IllegalArgumentException("La dimension " + row.dimensionId()
                        + " no pertenece a la version de la regla " + ruleId);
            }
        }
        for (OpcionPuntajeDimension old : rowsOfRule(ruleId)) {
            em.remove(old);
        }
        em.flush();
        LocalDateTime now = LocalDateTime.now(clock);
        List<OptionScoreDTO> saved = new ArrayList<>();
        for (OptionScoreRow row : requested) {
            OpcionPuntajeDimension entity = new OpcionPuntajeDimension();
            entity.setReglaCalificacion(rule);
            entity.setOpcion(options.get(row.optionId()));
            entity.setDimensionResultado(dimensions.get(row.dimensionId()));
            entity.setPuntaje(row.score());
            entity.setPeso(row.weight() == null ? BigDecimal.ONE : row.weight());
            entity.setActiva(row.active() == null || row.active());
            entity.setCreadoEn(now);
            em.persist(entity);
            saved.add(OptionScoreDTO.from(entity));
        }
        return saved;
    }

    private void validateRows(List<OptionScoreRow> rows) {
        Set<String> pairs = new HashSet<>();
        for (OptionScoreRow row : rows) {
            if (row == null || row.optionId() == null || row.dimensionId() == null || row.score() == null) {
                throw new IllegalArgumentException("Cada fila requiere optionId, dimensionId y score");
            }
            if (row.score().signum() < 0) {
                throw new IllegalArgumentException("score debe ser mayor o igual a 0 (opcion " + row.optionId() + ")");
            }
            if (row.weight() != null && row.weight().signum() <= 0) {
                throw new IllegalArgumentException("weight debe ser mayor que 0 (opcion " + row.optionId() + ")");
            }
            if (!pairs.add(row.optionId() + ":" + row.dimensionId())) {
                throw new IllegalArgumentException("Par opcion-dimension duplicado: opcion " + row.optionId()
                        + ", dimension " + row.dimensionId());
            }
        }
    }

    private Map<Long, OpcionItem> loadOptions(List<OptionScoreRow> rows) {
        Set<Long> ids = new HashSet<>();
        rows.forEach(row -> ids.add(row.optionId()));
        Map<Long, OpcionItem> result = new HashMap<>();
        if (!ids.isEmpty()) {
            em.createQuery("select o from OpcionItem o join fetch o.item i join fetch i.subtest s "
                    + "where o.id in :ids", OpcionItem.class)
                    .setParameter("ids", ids).getResultList().forEach(o -> result.put(o.getId(), o));
        }
        for (Long id : ids) {
            if (!result.containsKey(id)) {
                throw new IllegalArgumentException("La opcion " + id + " no existe");
            }
        }
        return result;
    }

    private Map<Long, DimensionResultado> loadDimensions(List<OptionScoreRow> rows) {
        Set<Long> ids = new HashSet<>();
        rows.forEach(row -> ids.add(row.dimensionId()));
        Map<Long, DimensionResultado> result = new HashMap<>();
        if (!ids.isEmpty()) {
            em.createQuery("select d from DimensionResultado d where d.id in :ids", DimensionResultado.class)
                    .setParameter("ids", ids).getResultList().forEach(d -> result.put(d.getId(), d));
        }
        for (Long id : ids) {
            if (!result.containsKey(id)) {
                throw new IllegalArgumentException("La dimension " + id + " no existe");
            }
        }
        return result;
    }

    /** Misma regla que {@code fn_bfa_alcance_cubre_item}: version de la regla y, si existen, su subtest e item. */
    private void assertOptionInScope(ReglaCalificacion rule, OpcionItem option) {
        var item = option.getItem();
        var subtest = item.getSubtest();
        boolean covered = subtest.getVersionTest().getId().equals(rule.getVersionTest().getId())
                && (rule.getSubtest() == null || subtest.getId().equals(rule.getSubtest().getId()))
                && (rule.getItem() == null || item.getId().equals(rule.getItem().getId()));
        if (!covered) {
            throw new IllegalArgumentException("La opcion " + option.getId()
                    + " esta fuera del alcance de la regla " + rule.getId());
        }
    }

    private void assertUnique(List<DimensionResultado> existing, String code, Integer order, Long excludeId) {
        for (DimensionResultado other : existing) {
            if (other.getId().equals(excludeId)) {
                continue;
            }
            if (other.getCodigoDimension().equals(code)) {
                throw new IllegalArgumentException("Ya existe una dimension con codigo " + code + " en la version");
            }
            if (other.getOrdenPresentacion().equals(order)) {
                throw new IllegalArgumentException("Ya existe una dimension con orden " + order + " en la version");
            }
        }
    }

    private static void assertRange(BigDecimal min, BigDecimal max) {
        if (min != null && max != null && min.compareTo(max) > 0) {
            throw new IllegalArgumentException("minScore no puede ser mayor que maxScore");
        }
    }

    private Subtest resolveSubtest(VersionTest version, Long subtestId) {
        if (subtestId == null) {
            return null;
        }
        Subtest subtest = em.find(Subtest.class, subtestId);
        if (subtest == null || !subtest.getVersionTest().getId().equals(version.getId())) {
            throw new IllegalArgumentException("El subtest " + subtestId + " no pertenece a la version "
                    + version.getId());
        }
        return subtest;
    }

    private void addReference(List<String> references, String label, String jpql, long dimensionId) {
        Long count = em.createQuery(jpql, Long.class).setParameter("id", dimensionId).getSingleResult();
        if (count != null && count > 0) {
            references.add(count + " " + label);
        }
    }

    private List<DimensionResultado> dimensionsOfVersion(long versionId) {
        return em.createQuery("select d from DimensionResultado d where d.versionTest.id = :versionId "
                + "order by d.ordenPresentacion asc, d.id asc", DimensionResultado.class)
                .setParameter("versionId", versionId).getResultList();
    }

    private List<OpcionPuntajeDimension> rowsOfRule(long ruleId) {
        return em.createQuery("select o from OpcionPuntajeDimension o where o.reglaCalificacion.id = :ruleId "
                + "order by o.opcion.id asc, o.dimensionResultado.id asc", OpcionPuntajeDimension.class)
                .setParameter("ruleId", ruleId).getResultList();
    }

    private VersionTest requireDraft(long versionId) {
        VersionTest version = versions.findByIdForUpdate(versionId)
                .orElseThrow(() -> new EntityNotFoundException("Version no encontrada: " + versionId));
        if (version.getEstado() != EstadoVersionTest.BORRADOR) {
            throw new IllegalStateException("La version publicada o aprobada no se edita directamente");
        }
        return version;
    }

    private <T> T find(Class<T> type, Object id) {
        T value = em.find(type, id);
        if (value == null) {
            throw new EntityNotFoundException(type.getSimpleName() + " no encontrado: " + id);
        }
        return value;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    /** Datos de una dimension; en la edicion los nulos conservan el valor actual. */
    public record DimensionCommand(String code, String name, String description, Long subtestId, Integer order,
            BigDecimal minScore, BigDecimal maxScore, Boolean active) {
    }

    /** Fila de la matriz; {@code weight} nulo = 1 y {@code active} nulo = true. */
    public record OptionScoreRow(Long optionId, Long dimensionId, BigDecimal score, BigDecimal weight,
            Boolean active) {
    }
}
