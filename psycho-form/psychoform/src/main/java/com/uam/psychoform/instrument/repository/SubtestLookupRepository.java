package com.uam.psychoform.instrument.repository;

import com.uam.psychoform.instrument.model.Subtest;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface SubtestLookupRepository extends JpaRepository<Subtest, Long> {
    /** Subtests de la version (con su estrategia propia) en orden de presentacion. */
    @Query("""
            select s from Subtest s
            left join fetch s.estrategiaCalificacion
            where s.versionTest.id = :versionTestId
            order by s.numeroOrden asc, s.id asc
            """)
    List<Subtest> findByVersionId(Long versionTestId);
}
