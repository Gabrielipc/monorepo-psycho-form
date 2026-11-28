package com.uam.psychoform.scoring.service;

import jakarta.persistence.EntityManager;
import org.mockito.Mockito;

/** {@link EntityManager} de prueba cuyo {@code getReference} devuelve una instancia vacia con el id pedido. */
final class EntityReferences {
    private EntityReferences() {
    }

    static EntityManager entityManager() {
        EntityManager em = Mockito.mock(EntityManager.class);
        Mockito.when(em.getReference(Mockito.any(Class.class), Mockito.any())).thenAnswer(invocation -> {
            Class<?> type = invocation.getArgument(0);
            Object id = invocation.getArgument(1);
            Object instance = type.getDeclaredConstructor().newInstance();
            type.getMethod("setId", id.getClass()).invoke(instance, id);
            return instance;
        });
        return em;
    }
}
