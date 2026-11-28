package com.uam.psychoform.instrument.repository;

import com.uam.psychoform.instrument.model.Baremo;
import com.uam.psychoform.instrument.model.EstadoConfiguracion;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface BaremoRepository extends JpaRepository<Baremo, Long> {
    default List<Baremo> findCandidatesByDimensions(Long versionTestId, Collection<Long> dimensionIds) {
        return findCandidatesByDimensionsAndEstados(versionTestId, dimensionIds,
                List.of(EstadoConfiguracion.APROBADO, EstadoConfiguracion.PUBLICADO));
    }

    default List<Baremo> findTotalCandidates(Long versionTestId) {
        return findTotalCandidatesByEstados(versionTestId,
                List.of(EstadoConfiguracion.APROBADO, EstadoConfiguracion.PUBLICADO));
    }

    /** Baremos oficiales de las dimensiones indicadas (con los datos de sus criterios normativos). */
    @Query("""
            select b from Baremo b
            join fetch b.dimensionResultado
            left join fetch b.criterioSexo
            left join fetch b.criterioCarrera
            where b.versionTest.id = :versionTestId
              and b.dimensionResultado.id in :dimensionIds
              and b.estado in :estados
            """)
    List<Baremo> findCandidatesByDimensionsAndEstados(Long versionTestId, Collection<Long> dimensionIds,
            Collection<EstadoConfiguracion> estados);

    /** Baremos oficiales del puntaje total (sin dimension). */
    @Query("""
            select b from Baremo b
            left join fetch b.criterioSexo
            left join fetch b.criterioCarrera
            where b.versionTest.id = :versionTestId
              and b.dimensionResultado is null
              and b.estado in :estados
            """)
    List<Baremo> findTotalCandidatesByEstados(Long versionTestId, Collection<EstadoConfiguracion> estados);
}
