package com.uam.psychoform.scoring.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.uam.psychoform.academic.model.Carrera;
import com.uam.psychoform.academic.model.CatalogoSexo;
import com.uam.psychoform.instrument.model.Baremo;
import com.uam.psychoform.instrument.model.DimensionResultado;
import com.uam.psychoform.instrument.model.RangoBaremo;
import com.uam.psychoform.instrument.repository.BaremoRepository;
import com.uam.psychoform.instrument.repository.RangoBaremoRepository;
import com.uam.psychoform.scoring.service.strategy.NormativeProfile;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class BaremoResolverTest {
    private static final long VERSION = 100L;
    private static final LocalDate TODAY = LocalDate.of(2026, 6, 24);

    private final BaremoRepository baremos = Mockito.mock(BaremoRepository.class);
    private final RangoBaremoRepository rangos = Mockito.mock(RangoBaremoRepository.class);
    private final BaremoResolver resolver = new BaremoResolver(baremos, rangos);

    private static NormativeProfile profile(Integer age, Integer sex, Integer career) {
        return new NormativeProfile(age, sex == null ? null : sex.shortValue(), career == null ? null : career.shortValue(),
                TODAY);
    }

    private static Baremo baremo(long id, Long dimensionId) {
        Baremo baremo = new Baremo();
        baremo.setId(id);
        baremo.setCodigoBaremo("B" + id);
        if (dimensionId != null) {
            DimensionResultado dimension = new DimensionResultado();
            dimension.setId(dimensionId);
            baremo.setDimensionResultado(dimension);
        }
        return baremo;
    }

    private static Baremo withAge(Baremo baremo, int min, int max) {
        baremo.setCriterioEdadMinima((short) min);
        baremo.setCriterioEdadMaxima((short) max);
        return baremo;
    }

    private static Baremo withSex(Baremo baremo, int sexId) {
        CatalogoSexo sexo = new CatalogoSexo();
        sexo.setId((short) sexId);
        baremo.setCriterioSexo(sexo);
        return baremo;
    }

    private static Baremo withCareer(Baremo baremo, int careerId) {
        Carrera carrera = new Carrera();
        carrera.setId((short) careerId);
        baremo.setCriterioCarrera(carrera);
        return baremo;
    }

    private static RangoBaremo range(Baremo baremo, long id, int order, String min, String max, String category) {
        RangoBaremo range = new RangoBaremo();
        range.setId(id);
        range.setBaremo(baremo);
        range.setOrden(order);
        range.setPuntajeMinimo(new BigDecimal(min));
        range.setPuntajeMaximo(new BigDecimal(max));
        range.setCategoria(category);
        return range;
    }

    private void totals(Baremo... candidates) {
        when(baremos.findTotalCandidates(VERSION)).thenReturn(List.of(candidates));
        List<RangoBaremo> all = new ArrayList<>();
        for (Baremo baremo : candidates) {
            all.add(range(baremo, baremo.getId() * 10, 1, "0", "10", "Bajo-" + baremo.getCodigoBaremo()));
        }
        when(rangos.findByBaremoIdInOrderByBaremoAndRangeOrder(Mockito.anyCollection())).thenReturn(all);
    }

    private Optional<AppliedNorm> total(NormativeProfile profile, String score) {
        return resolver.resolve(VERSION, null, profile, new BigDecimal(score));
    }

    @Test
    void sinCandidatosNoHayNorma() {
        totals();

        assertThat(total(profile(20, 1, 2), "5")).isEmpty();
    }

    @Test
    void prefiereElBaremoMasEspecifico() {
        Baremo general = baremo(1, null);
        Baremo porEdad = withAge(baremo(2, null), 18, 25);
        Baremo edadYSexo = withSex(withAge(baremo(3, null), 18, 25), 1);
        Baremo todo = withCareer(withSex(withAge(baremo(4, null), 18, 25), 1), 7);
        totals(general, porEdad, edadYSexo, todo);

        assertThat(total(profile(20, 1, 7), "5").orElseThrow().baremo().getId()).isEqualTo(4L);
        assertThat(total(profile(20, 1, 8), "5").orElseThrow().baremo().getId()).isEqualTo(3L);
        assertThat(total(profile(20, 2, 8), "5").orElseThrow().baremo().getId()).isEqualTo(2L);
        assertThat(total(profile(40, 2, 8), "5").orElseThrow().baremo().getId()).isEqualTo(1L);
    }

    @Test
    void edadYCarreraEspecificasTambienGananAlGeneral() {
        Baremo general = baremo(1, null);
        Baremo carrera = withCareer(baremo(2, null), 7);
        totals(general, carrera);

        assertThat(total(profile(20, 1, 7), "5").orElseThrow().baremo().getId()).isEqualTo(2L);
        assertThat(total(profile(20, 1, 9), "5").orElseThrow().baremo().getId()).isEqualTo(1L);
    }

    @Test
    void extremosDeEdadNulosSonAbiertosYLosLimitesSonInclusivos() {
        Baremo abierto = baremo(1, null);
        abierto.setCriterioEdadMinima((short) 30);
        totals(abierto);

        assertThat(total(profile(30, null, null), "5")).isPresent();
        assertThat(total(profile(29, null, null), "5")).isEmpty();
        assertThat(total(profile(90, null, null), "5")).isPresent();
    }

    @Test
    void criterioExigidoConPerfilNuloNoAplica() {
        Baremo edad = withAge(baremo(1, null), 18, 25);
        Baremo sexo = withSex(baremo(2, null), 1);
        Baremo carrera = withCareer(baremo(3, null), 7);
        Baremo general = baremo(4, null);
        totals(edad, sexo, carrera, general);

        assertThat(total(profile(null, null, null), "5").orElseThrow().baremo().getId()).isEqualTo(4L);
    }

    @Test
    void vigenciaFueraDeFechaNoAplicaYLosExtremosSonInclusivos() {
        Baremo vigente = baremo(1, null);
        vigente.setVigenteDesde(TODAY);
        vigente.setVigenteHasta(TODAY);
        Baremo vencido = baremo(2, null);
        vencido.setVigenteHasta(TODAY.minusDays(1));
        Baremo futuro = baremo(3, null);
        futuro.setVigenteDesde(TODAY.plusDays(1));
        totals(vencido, futuro);

        assertThat(total(profile(20, 1, 1), "5")).isEmpty();

        totals(vencido, futuro, vigente);
        assertThat(total(profile(20, 1, 1), "5").orElseThrow().baremo().getId()).isEqualTo(1L);
    }

    @Test
    void empateDeEspecificidadSeDesempataPorAprobadoEnYLuegoPorId() {
        Baremo viejo = baremo(1, null);
        viejo.setAprobadoEn(LocalDateTime.of(2026, 1, 1, 0, 0));
        Baremo reciente = baremo(2, null);
        reciente.setAprobadoEn(LocalDateTime.of(2026, 3, 1, 0, 0));
        Baremo sinFecha = baremo(9, null);
        totals(viejo, sinFecha, reciente);

        assertThat(total(profile(20, 1, 1), "5").orElseThrow().baremo().getId()).isEqualTo(2L);

        Baremo igualA = baremo(3, null);
        igualA.setAprobadoEn(LocalDateTime.of(2026, 3, 1, 0, 0));
        totals(reciente, igualA);
        assertThat(total(profile(20, 1, 1), "5").orElseThrow().baremo().getId()).isEqualTo(3L);

        // sin fechas: gana el id mayor
        totals(sinFecha, baremo(4, null));
        assertThat(total(profile(20, 1, 1), "5").orElseThrow().baremo().getId()).isEqualTo(9L);
    }

    @Test
    void puntajeFueraDeTodoRangoConservaElBaremoConRangoNulo() {
        Baremo general = baremo(1, null);
        when(baremos.findTotalCandidates(VERSION)).thenReturn(List.of(general));
        when(rangos.findByBaremoIdInOrderByBaremoAndRangeOrder(Mockito.anyCollection()))
                .thenReturn(List.of(range(general, 10, 1, "0", "10", "Bajo")));

        AppliedNorm norm = total(profile(20, 1, 1), "50").orElseThrow();

        assertThat(norm.baremo()).isSameAs(general);
        assertThat(norm.range()).isNull();
    }

    @Test
    void elRangoElegidoEsElPrimeroPorOrdenYLuegoPorId() {
        Baremo general = baremo(1, null);
        when(baremos.findTotalCandidates(VERSION)).thenReturn(List.of(general));
        when(rangos.findByBaremoIdInOrderByBaremoAndRangeOrder(Mockito.anyCollection())).thenReturn(List.of(
                range(general, 12, 2, "0", "10", "Segundo"), range(general, 11, 1, "5", "10", "Primero"),
                range(general, 10, 1, "6", "10", "OtroPrimero")));

        assertThat(total(profile(20, 1, 1), "6").orElseThrow().range().getCategoria()).isEqualTo("OtroPrimero");
        assertThat(total(profile(20, 1, 1), "5").orElseThrow().range().getCategoria()).isEqualTo("Primero");
        assertThat(total(profile(20, 1, 1), "0").orElseThrow().range().getCategoria()).isEqualTo("Segundo");
    }

    @Test
    void baremoTotalYPorDimensionSeResuelvenPorSeparado() {
        Baremo totalBaremo = baremo(1, null);
        Baremo dimension7 = baremo(2, 7L);
        Baremo dimension8 = baremo(3, 8L);
        Baremo dimension8Especifico = withSex(baremo(4, 8L), 1);
        when(baremos.findTotalCandidates(VERSION)).thenReturn(List.of(totalBaremo));
        when(baremos.findCandidatesByDimensions(Mockito.eq(VERSION), Mockito.anyCollection()))
                .thenReturn(List.of(dimension7, dimension8, dimension8Especifico));
        when(rangos.findByBaremoIdInOrderByBaremoAndRangeOrder(Mockito.anyCollection())).thenAnswer(invocation -> {
            java.util.Collection<Long> ids = invocation.getArgument(0);
            return ids.stream().map(id -> range(baremo(id, null), id * 10, 1, "0", "100", "R" + id)).toList();
        });

        Map<Long, AppliedNorm> byDimension = resolver.resolveDimensions(VERSION, profile(20, 1, 1),
                Map.of(7L, new BigDecimal("5"), 8L, new BigDecimal("6")));

        assertThat(byDimension.get(7L).baremo().getId()).isEqualTo(2L);
        assertThat(byDimension.get(8L).baremo().getId()).isEqualTo(4L);
        assertThat(byDimension.get(8L).range().getCategoria()).isEqualTo("R4");
        assertThat(resolver.resolve(VERSION, null, profile(20, 1, 1), new BigDecimal("5")).orElseThrow().baremo()
                .getId()).isEqualTo(1L);
        assertThat(resolver.resolve(VERSION, 7L, profile(20, 1, 1), new BigDecimal("5")).orElseThrow().baremo()
                .getId()).isEqualTo(2L);
        // una sola consulta de baremos por dimension en lote
        Mockito.verify(baremos, Mockito.times(2)).findCandidatesByDimensions(Mockito.eq(VERSION),
                Mockito.anyCollection());
    }

    @Test
    void dimensionesSinBaremoAplicableNoAparecenEnElMapa() {
        when(baremos.findCandidatesByDimensions(Mockito.eq(VERSION), Mockito.anyCollection()))
                .thenReturn(List.of(withSex(baremo(2, 7L), 2)));
        when(rangos.findByBaremoIdInOrderByBaremoAndRangeOrder(Mockito.anyCollection())).thenReturn(List.of());

        assertThat(resolver.resolveDimensions(VERSION, profile(20, 1, 1), Map.of(7L, BigDecimal.ONE, 9L, BigDecimal.ONE)))
                .isEmpty();
        assertThat(resolver.resolveDimensions(VERSION, profile(20, 1, 1), Map.of())).isEmpty();
    }
}
