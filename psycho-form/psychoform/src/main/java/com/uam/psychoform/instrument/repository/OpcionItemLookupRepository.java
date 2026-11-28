package com.uam.psychoform.instrument.repository;

import com.uam.psychoform.instrument.model.OpcionItem;
import com.uam.psychoform.security.model.EstadoGeneral;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface OpcionItemLookupRepository extends JpaRepository<OpcionItem, Long> {
    List<OpcionItem> findByItemIdAndEstadoOrderByNumeroOrdenAsc(Long itemId, EstadoGeneral estado);

    @Query("""
            select opcion from OpcionItem opcion
            where opcion.item.id in :itemIds
              and opcion.estado = :estado
            order by opcion.item.numeroOrden asc, opcion.numeroOrden asc
            """)
    List<OpcionItem> findByItemIdInAndEstadoOrderByItemAndOptionOrder(Collection<Long> itemIds, EstadoGeneral estado);

    /** Opciones (de cualquier estado) de los items activos de subtests activos de la version. */
    @Query("""
            select opcion from OpcionItem opcion
            join fetch opcion.item item
            join item.subtest subtest
            where subtest.versionTest.id = :versionTestId
              and subtest.estado = :estadoItem
              and item.estado = :estadoItem
            order by opcion.item.id asc, opcion.numeroOrden asc, opcion.id asc
            """)
    List<OpcionItem> findByVersionIdAndItemEstado(Long versionTestId, EstadoGeneral estadoItem);

    default List<OpcionItem> findOfActiveItemsByVersionId(Long versionTestId) {
        return findByVersionIdAndItemEstado(versionTestId, EstadoGeneral.ACTIVO);
    }
}
