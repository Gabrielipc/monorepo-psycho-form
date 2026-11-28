package com.uam.psychoform.instrument.repository;

import com.uam.psychoform.instrument.model.RangoBaremo;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface RangoBaremoRepository extends JpaRepository<RangoBaremo, Long> {
    @Query("""
            select r from RangoBaremo r
            join fetch r.baremo
            where r.baremo.id in :baremoIds
            order by r.baremo.id asc, r.orden asc, r.id asc
            """)
    List<RangoBaremo> findByBaremoIdInOrderByBaremoAndRangeOrder(Collection<Long> baremoIds);
}
