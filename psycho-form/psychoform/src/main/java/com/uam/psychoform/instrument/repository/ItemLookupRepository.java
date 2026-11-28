package com.uam.psychoform.instrument.repository;

import com.uam.psychoform.instrument.model.Item;
import com.uam.psychoform.security.model.EstadoGeneral;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface ItemLookupRepository extends JpaRepository<Item, Long> {
    List<Item> findBySubtestIdAndEstadoOrderByNumeroOrdenAsc(Long subtestId, EstadoGeneral estado);

    @Query("""
            select item from Item item
            where item.subtest.id in :subtestIds
              and item.estado = :estado
            order by item.subtest.numeroOrden asc, item.numeroOrden asc
            """)
    List<Item> findBySubtestIdInAndEstadoOrderBySubtestAndItemOrder(Collection<Long> subtestIds,
            EstadoGeneral estado);

    /** Items activos de subtests activos de la version, en orden de subtest e item. */
    default List<Item> findActiveByVersionId(Long versionTestId) {
        return findByVersionIdAndEstado(versionTestId, EstadoGeneral.ACTIVO);
    }

    @Query("""
            select item from Item item
            join fetch item.subtest subtest
            where subtest.versionTest.id = :versionTestId
              and subtest.estado = :estado
              and item.estado = :estado
            order by subtest.numeroOrden asc, subtest.id asc, item.numeroOrden asc, item.id asc
            """)
    List<Item> findByVersionIdAndEstado(Long versionTestId, EstadoGeneral estado);
}
