package com.uam.psychoform.instrument.repository;

import com.uam.psychoform.instrument.model.EstadoConfiguracion;
import com.uam.psychoform.instrument.model.ReglaCalificacion;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface ReglaCalificacionLookupRepository extends JpaRepository<ReglaCalificacion, Long> {
    default List<ReglaCalificacion> findOfficialByVersionId(Long versionTestId) {
        return findActiveByVersionIdAndEstados(versionTestId,
                List.of(EstadoConfiguracion.APROBADO, EstadoConfiguracion.PUBLICADO));
    }

    /** Reglas activas de la version en los estados indicados. */
    @Query("""
            select r from ReglaCalificacion r
            left join fetch r.subtest
            left join fetch r.item
            where r.versionTest.id = :versionTestId
              and r.activa = true
              and r.estado in :estados
            order by r.prioridad asc, r.id asc
            """)
    List<ReglaCalificacion> findActiveByVersionIdAndEstados(Long versionTestId,
            Collection<EstadoConfiguracion> estados);
}
