package com.uam.psychoform.instrument.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.uam.psychoform.instrument.dto.DimensionDTO;
import com.uam.psychoform.instrument.dto.OptionScoreDTO;
import com.uam.psychoform.instrument.model.*;
import com.uam.psychoform.instrument.repository.VersionTestRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import jakarta.persistence.TypedQuery;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mockito;

class ScoringDimensionAdminServiceTest {
    private final EntityManager em = Mockito.mock(EntityManager.class);
    private final VersionTestRepository versions = Mockito.mock(VersionTestRepository.class);
    private final ScoringDimensionAdminService service = new ScoringDimensionAdminService(em, versions,
            Clock.fixed(Instant.parse("2026-06-26T10:15:30Z"), ZoneOffset.UTC));

    // ---------- dimensiones ----------

    @Test
    void listDimensionsReturnsDtosInQueryOrder() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        when(em.find(VersionTest.class, 1L)).thenReturn(version);
        stubQuery("from DimensionResultado d where d.versionTest.id", DimensionResultado.class,
                List.of(dimension(10L, version, "A", 1), dimension(11L, version, "B", 2)));

        List<DimensionDTO> result = service.listDimensions(1L);

        assertThat(result).extracting(DimensionDTO::codigoDimension).containsExactly("A", "B");
        assertThat(result.getFirst().versionTestId()).isEqualTo(1L);
    }

    @Test
    void createDimensionPersistsWithDefaults() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        when(versions.findByIdForUpdate(1L)).thenReturn(Optional.of(version));
        Subtest subtest = subtest(5L, version);
        when(em.find(Subtest.class, 5L)).thenReturn(subtest);
        stubQuery("from DimensionResultado d where d.versionTest.id", DimensionResultado.class, List.of());

        DimensionDTO created = service.createDimension(1L, new ScoringDimensionAdminService.DimensionCommand(
                "FI", "Fluidez", "desc", 5L, 1, BigDecimal.ZERO, BigDecimal.TEN, null));

        ArgumentCaptor<DimensionResultado> captor = ArgumentCaptor.forClass(DimensionResultado.class);
        verify(em).persist(captor.capture());
        DimensionResultado saved = captor.getValue();
        assertThat(saved.getCodigoDimension()).isEqualTo("FI");
        assertThat(saved.getSubtest()).isSameAs(subtest);
        assertThat(saved.getActiva()).isTrue();
        assertThat(saved.getCreadoEn()).isNotNull();
        assertThat(created.subtestId()).isEqualTo(5L);
    }

    @Test
    void writesRequireDraftVersion() {
        for (EstadoVersionTest estado : List.of(EstadoVersionTest.APROBADO, EstadoVersionTest.PUBLICADO,
                EstadoVersionTest.RETIRADO)) {
            VersionTest version = version(1L, estado);
            when(versions.findByIdForUpdate(1L)).thenReturn(Optional.of(version));
            assertThatThrownBy(() -> service.createDimension(1L, command("X", 1)))
                    .as(estado.name()).isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("no se edita directamente");
        }
        verify(em, never()).persist(Mockito.any());
    }

    @Test
    void createDimensionRejectsDuplicateCodeAndOrder() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        when(versions.findByIdForUpdate(1L)).thenReturn(Optional.of(version));
        stubQuery("from DimensionResultado d where d.versionTest.id", DimensionResultado.class,
                List.of(dimension(10L, version, "FI", 1)));

        assertThatThrownBy(() -> service.createDimension(1L, command("FI", 2)))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("codigo FI");
        assertThatThrownBy(() -> service.createDimension(1L, command("OTRA", 1)))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("orden 1");
    }

    @Test
    void createDimensionRejectsForeignSubtestAndInvertedRange() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        when(versions.findByIdForUpdate(1L)).thenReturn(Optional.of(version));
        stubQuery("from DimensionResultado d where d.versionTest.id", DimensionResultado.class, List.of());
        when(em.find(Subtest.class, 9L)).thenReturn(subtest(9L, version(2L, EstadoVersionTest.BORRADOR)));

        assertThatThrownBy(() -> service.createDimension(1L,
                new ScoringDimensionAdminService.DimensionCommand("A", "A", null, 9L, 1, null, null, null)))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("no pertenece a la version");
        assertThatThrownBy(() -> service.createDimension(1L,
                new ScoringDimensionAdminService.DimensionCommand("A", "A", null, null, 1,
                        BigDecimal.TEN, BigDecimal.ONE, null)))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("minScore");
    }

    @Test
    void updateDimensionKeepsValuesForNullFieldsAndAllowsOwnCode() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        DimensionResultado dimension = dimension(10L, version, "FI", 1);
        dimension.setPuntajeMaximo(BigDecimal.TEN);
        when(em.find(DimensionResultado.class, 10L)).thenReturn(dimension);
        when(versions.findByIdForUpdate(1L)).thenReturn(Optional.of(version));
        stubQuery("from DimensionResultado d where d.versionTest.id", DimensionResultado.class,
                List.of(dimension, dimension(11L, version, "OTRA", 2)));

        DimensionDTO updated = service.updateDimension(10L, new ScoringDimensionAdminService.DimensionCommand(
                "FI", null, null, null, null, BigDecimal.ONE, null, false));

        assertThat(updated.codigoDimension()).isEqualTo("FI");
        assertThat(updated.nombreDimension()).isEqualTo("Dim FI");
        assertThat(updated.ordenPresentacion()).isEqualTo(1);
        assertThat(updated.puntajeMinimo()).isEqualByComparingTo("1");
        assertThat(updated.puntajeMaximo()).isEqualByComparingTo("10");
        assertThat(updated.activa()).isFalse();
    }

    @Test
    void updateDimensionRejectsCodeOfAnotherDimensionAndMergedInvertedRange() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        DimensionResultado dimension = dimension(10L, version, "FI", 1);
        dimension.setPuntajeMaximo(BigDecimal.TEN);
        when(em.find(DimensionResultado.class, 10L)).thenReturn(dimension);
        when(versions.findByIdForUpdate(1L)).thenReturn(Optional.of(version));
        stubQuery("from DimensionResultado d where d.versionTest.id", DimensionResultado.class,
                List.of(dimension, dimension(11L, version, "OTRA", 2)));

        assertThatThrownBy(() -> service.updateDimension(10L, new ScoringDimensionAdminService.DimensionCommand(
                "OTRA", null, null, null, null, null, null, null)))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("codigo OTRA");
        assertThatThrownBy(() -> service.updateDimension(10L, new ScoringDimensionAdminService.DimensionCommand(
                null, null, null, null, null, BigDecimal.valueOf(50), null, null)))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("minScore");
    }

    @Test
    void deleteDimensionIsBlockedWhenReferencedAndSuggestsDeactivating() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        DimensionResultado dimension = dimension(10L, version, "FI", 1);
        when(em.find(DimensionResultado.class, 10L)).thenReturn(dimension);
        when(versions.findByIdForUpdate(1L)).thenReturn(Optional.of(version));
        stubCount("from Baremo b", 2L);
        stubCount("from OpcionPuntajeDimension o", 0L);
        stubCount("from CalificacionRespuesta c", 0L);
        stubCount("from ResultadoDimension r", 0L);

        assertThatThrownBy(() -> service.deleteDimension(10L))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("2 baremo(s)").hasMessageContaining("active=false");
        verify(em, never()).remove(dimension);
    }

    @Test
    void deleteDimensionRemovesUnreferencedDimension() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        DimensionResultado dimension = dimension(10L, version, "FI", 1);
        when(em.find(DimensionResultado.class, 10L)).thenReturn(dimension);
        when(versions.findByIdForUpdate(1L)).thenReturn(Optional.of(version));
        stubCount("from Baremo b", 0L);
        stubCount("from OpcionPuntajeDimension o", 0L);
        stubCount("from CalificacionRespuesta c", 0L);
        stubCount("from ResultadoDimension r", 0L);

        service.deleteDimension(10L);

        verify(em).remove(dimension);
    }

    @Test
    void deleteDimensionOfPublishedVersionIsConflict() {
        VersionTest version = version(1L, EstadoVersionTest.PUBLICADO);
        when(em.find(DimensionResultado.class, 10L)).thenReturn(dimension(10L, version, "FI", 1));
        when(versions.findByIdForUpdate(1L)).thenReturn(Optional.of(version));

        assertThatThrownBy(() -> service.deleteDimension(10L)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void unknownDimensionIsNotFound() {
        assertThatThrownBy(() -> service.deleteDimension(99L)).isInstanceOf(EntityNotFoundException.class);
    }

    // ---------- matriz ----------

    @Test
    void replaceOptionScoresReplacesWholeSetInOrder() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        Subtest subtest = subtest(5L, version);
        Item item = item(7L, subtest);
        OpcionItem a = option(30L, item);
        OpcionItem b = option(31L, item);
        ReglaCalificacion rule = rule(40L, version, subtest, null);
        DimensionResultado d1 = dimension(10L, version, "FI", 1);
        DimensionResultado d2 = dimension(11L, version, "FD", 2);
        OpcionPuntajeDimension old = new OpcionPuntajeDimension();
        old.setId(1L);
        stubFind(rule, version);
        stubQuery("from OpcionItem o", OpcionItem.class, List.of(a, b));
        stubQuery("from DimensionResultado d where d.id in", DimensionResultado.class, List.of(d1, d2));
        stubQuery("from OpcionPuntajeDimension o where o.reglaCalificacion.id", OpcionPuntajeDimension.class,
                List.of(old));

        List<OptionScoreDTO> saved = service.replaceOptionScores(40L, List.of(
                new ScoringDimensionAdminService.OptionScoreRow(30L, 10L, BigDecimal.ONE, null, null),
                new ScoringDimensionAdminService.OptionScoreRow(31L, 11L, BigDecimal.TWO, new BigDecimal("0.5"),
                        false)));

        InOrder order = Mockito.inOrder(em);
        order.verify(em).remove(old);
        order.verify(em).flush();
        order.verify(em, Mockito.times(2)).persist(Mockito.any(OpcionPuntajeDimension.class));
        assertThat(saved).hasSize(2);
        assertThat(saved.get(0).peso()).isEqualByComparingTo("1");
        assertThat(saved.get(0).activa()).isTrue();
        assertThat(saved.get(1).peso()).isEqualByComparingTo("0.5");
        assertThat(saved.get(1).activa()).isFalse();
        assertThat(saved.get(1).reglaCalificacionId()).isEqualTo(40L);
    }

    @Test
    void replaceWithEmptyListClearsRows() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        ReglaCalificacion rule = rule(40L, version, null, null);
        OpcionPuntajeDimension old = new OpcionPuntajeDimension();
        stubFind(rule, version);
        stubQuery("from OpcionPuntajeDimension o where o.reglaCalificacion.id", OpcionPuntajeDimension.class,
                List.of(old));

        assertThat(service.replaceOptionScores(40L, List.of())).isEmpty();

        verify(em).remove(old);
    }

    @Test
    void replaceOptionScoresRejectsOptionOutsideItemScopedRule() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        Subtest subtest = subtest(5L, version);
        Item ruleItem = item(7L, subtest);
        Item otherItem = item(8L, subtest);
        ReglaCalificacion rule = rule(40L, version, subtest, ruleItem);
        stubFind(rule, version);
        stubQuery("from OpcionItem o", OpcionItem.class, List.of(option(30L, otherItem)));
        stubQuery("from DimensionResultado d where d.id in", DimensionResultado.class,
                List.of(dimension(10L, version, "FI", 1)));

        assertThatThrownBy(() -> service.replaceOptionScores(40L, List.of(row(30L, 10L, "1"))))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("fuera del alcance");
        verify(em, never()).remove(Mockito.any());
    }

    @Test
    void replaceOptionScoresRejectsOptionOutsideSubtestAndVersionScope() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        Subtest ruleSubtest = subtest(5L, version);
        Subtest otherSubtest = subtest(6L, version);
        ReglaCalificacion subtestRule = rule(40L, version, ruleSubtest, null);
        stubFind(subtestRule, version);
        stubQuery("from OpcionItem o", OpcionItem.class, List.of(option(30L, item(7L, otherSubtest))));
        stubQuery("from DimensionResultado d where d.id in", DimensionResultado.class,
                List.of(dimension(10L, version, "FI", 1)));
        assertThatThrownBy(() -> service.replaceOptionScores(40L, List.of(row(30L, 10L, "1"))))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("fuera del alcance");

        Subtest foreign = subtest(9L, version(2L, EstadoVersionTest.BORRADOR));
        ReglaCalificacion versionRule = rule(41L, version, null, null);
        when(em.find(ReglaCalificacion.class, 41L)).thenReturn(versionRule);
        stubQuery("from OpcionItem o", OpcionItem.class, List.of(option(31L, item(8L, foreign))));
        assertThatThrownBy(() -> service.replaceOptionScores(41L, List.of(row(31L, 10L, "1"))))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("fuera del alcance");
    }

    @Test
    void replaceOptionScoresAcceptsAnyItemOfVersionForVersionScopedRule() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        ReglaCalificacion rule = rule(40L, version, null, null);
        stubFind(rule, version);
        stubQuery("from OpcionItem o", OpcionItem.class, List.of(option(30L, item(7L, subtest(5L, version)))));
        stubQuery("from DimensionResultado d where d.id in", DimensionResultado.class,
                List.of(dimension(10L, version, "FI", 1)));
        stubQuery("from OpcionPuntajeDimension o where o.reglaCalificacion.id", OpcionPuntajeDimension.class,
                List.of());

        assertThat(service.replaceOptionScores(40L, List.of(row(30L, 10L, "3")))).hasSize(1);
    }

    @Test
    void replaceOptionScoresRejectsDimensionOfAnotherVersion() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        Subtest subtest = subtest(5L, version);
        ReglaCalificacion rule = rule(40L, version, subtest, null);
        stubFind(rule, version);
        stubQuery("from OpcionItem o", OpcionItem.class, List.of(option(30L, item(7L, subtest))));
        stubQuery("from DimensionResultado d where d.id in", DimensionResultado.class,
                List.of(dimension(10L, version(2L, EstadoVersionTest.BORRADOR), "FI", 1)));

        assertThatThrownBy(() -> service.replaceOptionScores(40L, List.of(row(30L, 10L, "1"))))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("no pertenece a la version");
    }

    @Test
    void replaceOptionScoresValidatesValuesAndDuplicates() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        stubFind(rule(40L, version, null, null), version);

        assertThatThrownBy(() -> service.replaceOptionScores(40L, List.of(row(30L, 10L, "-1"))))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("score");
        assertThatThrownBy(() -> service.replaceOptionScores(40L, List.of(
                new ScoringDimensionAdminService.OptionScoreRow(30L, 10L, BigDecimal.ONE, BigDecimal.ZERO, null))))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("weight");
        assertThatThrownBy(() -> service.replaceOptionScores(40L,
                List.of(row(30L, 10L, "1"), row(30L, 10L, "2"))))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("duplicado");
    }

    @Test
    void replaceOptionScoresRejectsUnknownOptionAndNonDraftVersion() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        stubFind(rule(40L, version, null, null), version);
        stubQuery("from OpcionItem o", OpcionItem.class, List.of());
        assertThatThrownBy(() -> service.replaceOptionScores(40L, List.of(row(30L, 10L, "1"))))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("La opcion 30 no existe");

        VersionTest published = version(2L, EstadoVersionTest.PUBLICADO);
        ReglaCalificacion rule = rule(41L, published, null, null);
        when(em.find(ReglaCalificacion.class, 41L)).thenReturn(rule);
        when(versions.findByIdForUpdate(2L)).thenReturn(Optional.of(published));
        assertThatThrownBy(() -> service.replaceOptionScores(41L, List.of()))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void listOptionScoresMapsRows() {
        VersionTest version = version(1L, EstadoVersionTest.BORRADOR);
        Subtest subtest = subtest(5L, version);
        ReglaCalificacion rule = rule(40L, version, subtest, null);
        when(em.find(ReglaCalificacion.class, 40L)).thenReturn(rule);
        OpcionPuntajeDimension row = new OpcionPuntajeDimension();
        row.setId(3L);
        row.setReglaCalificacion(rule);
        row.setOpcion(option(30L, item(7L, subtest)));
        row.setDimensionResultado(dimension(10L, version, "FI", 1));
        row.setPuntaje(BigDecimal.ONE);
        row.setPeso(BigDecimal.ONE);
        row.setActiva(true);
        stubQuery("from OpcionPuntajeDimension o where o.reglaCalificacion.id", OpcionPuntajeDimension.class,
                List.of(row));

        assertThat(service.listOptionScores(40L)).singleElement().satisfies(dto -> {
            assertThat(dto.opcionId()).isEqualTo(30L);
            assertThat(dto.dimensionResultadoId()).isEqualTo(10L);
        });
    }

    // ---------- helpers ----------

    private static ScoringDimensionAdminService.DimensionCommand command(String code, int order) {
        return new ScoringDimensionAdminService.DimensionCommand(code, "Nombre", null, null, order, null, null,
                null);
    }

    private static ScoringDimensionAdminService.OptionScoreRow row(long option, long dimension, String score) {
        return new ScoringDimensionAdminService.OptionScoreRow(option, dimension, new BigDecimal(score), null, null);
    }

    private void stubFind(ReglaCalificacion rule, VersionTest version) {
        when(em.find(ReglaCalificacion.class, rule.getId())).thenReturn(rule);
        when(versions.findByIdForUpdate(version.getId())).thenReturn(Optional.of(version));
    }

    private <T> void stubQuery(String fragment, Class<T> type, List<T> result) {
        TypedQuery<T> query = Mockito.mock();
        when(em.createQuery(argThat((String jpql) -> jpql != null && jpql.contains(fragment)), eq(type)))
                .thenReturn(query);
        when(query.setParameter(Mockito.anyString(), Mockito.any())).thenReturn(query);
        when(query.getResultList()).thenReturn(result);
    }

    private void stubCount(String fragment, long count) {
        TypedQuery<Long> query = Mockito.mock();
        when(em.createQuery(argThat((String jpql) -> jpql != null && jpql.contains(fragment)), eq(Long.class)))
                .thenReturn(query);
        when(query.setParameter(Mockito.anyString(), Mockito.any())).thenReturn(query);
        when(query.getSingleResult()).thenReturn(count);
    }

    private static VersionTest version(long id, EstadoVersionTest estado) {
        VersionTest version = new VersionTest();
        version.setId(id);
        version.setEstado(estado);
        return version;
    }

    private static Subtest subtest(long id, VersionTest version) {
        Subtest subtest = new Subtest();
        subtest.setId(id);
        subtest.setVersionTest(version);
        return subtest;
    }

    private static Item item(long id, Subtest subtest) {
        Item item = new Item();
        item.setId(id);
        item.setSubtest(subtest);
        return item;
    }

    private static OpcionItem option(long id, Item item) {
        OpcionItem option = new OpcionItem();
        option.setId(id);
        option.setItem(item);
        return option;
    }

    private static ReglaCalificacion rule(long id, VersionTest version, Subtest subtest, Item item) {
        ReglaCalificacion rule = new ReglaCalificacion();
        rule.setId(id);
        rule.setVersionTest(version);
        rule.setSubtest(subtest);
        rule.setItem(item);
        return rule;
    }

    private static DimensionResultado dimension(long id, VersionTest version, String code, int order) {
        DimensionResultado dimension = new DimensionResultado();
        dimension.setId(id);
        dimension.setVersionTest(version);
        dimension.setCodigoDimension(code);
        dimension.setNombreDimension("Dim " + code);
        dimension.setOrdenPresentacion(order);
        dimension.setActiva(true);
        return dimension;
    }
}
