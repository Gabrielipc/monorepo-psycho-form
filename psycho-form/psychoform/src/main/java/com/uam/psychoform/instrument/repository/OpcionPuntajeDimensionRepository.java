package com.uam.psychoform.instrument.repository;

import com.uam.psychoform.instrument.model.EstadoConfiguracion;
import com.uam.psychoform.instrument.model.OpcionPuntajeDimension;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface OpcionPuntajeDimensionRepository extends JpaRepository<OpcionPuntajeDimension, Long> {
    default List<OpcionPuntajeDimension> findActiveOfficialByVersionAndOptionIds(Long versionTestId,
            Collection<Long> optionIds) {
        return findActiveOfficialByVersionAndOptionIdsAndEstados(versionTestId, optionIds,
                List.of(EstadoConfiguracion.APROBADO, EstadoConfiguracion.PUBLICADO));
    }

    @Query("""
            select opd from OpcionPuntajeDimension opd
            join fetch opd.opcion
            join fetch opd.dimensionResultado
            join fetch opd.reglaCalificacion regla
            where opd.activa = true
              and opd.opcion.id in :optionIds
              and regla.versionTest.id = :versionTestId
              and regla.activa = true
              and regla.estado in :estados
            """)
    List<OpcionPuntajeDimension> findActiveOfficialByVersionAndOptionIdsAndEstados(Long versionTestId,
            Collection<Long> optionIds, Collection<EstadoConfiguracion> estados);

    default List<OpcionPuntajeDimension> findActiveOfficialByVersionId(Long versionTestId) {
        return findActiveOfficialByVersionIdAndEstados(versionTestId,
                List.of(EstadoConfiguracion.APROBADO, EstadoConfiguracion.PUBLICADO));
    }

    /** Toda la matriz activa y oficial de la version, en un orden estable. */
    @Query("""
            select opd from OpcionPuntajeDimension opd
            join fetch opd.opcion
            join fetch opd.dimensionResultado
            join fetch opd.reglaCalificacion regla
            where opd.activa = true
              and regla.versionTest.id = :versionTestId
              and regla.activa = true
              and regla.estado in :estados
            order by opd.id asc
            """)
    List<OpcionPuntajeDimension> findActiveOfficialByVersionIdAndEstados(Long versionTestId,
            Collection<EstadoConfiguracion> estados);
}
