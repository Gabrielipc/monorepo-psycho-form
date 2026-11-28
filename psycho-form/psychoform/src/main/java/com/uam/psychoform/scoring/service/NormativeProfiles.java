package com.uam.psychoform.scoring.service;

import com.uam.psychoform.assessment.model.AsignacionTest;
import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.scoring.service.strategy.NormativeProfile;
import java.time.Clock;
import java.time.LocalDate;

/** Construye el perfil normativo de un intento a partir de los datos registrados en su asignacion. */
public final class NormativeProfiles {
    private NormativeProfiles() {
    }

    /**
     * Edad, sexo y carrera registrados al aplicar; la fecha de aplicacion es la de finalizacion del intento, si no la
     * de inicio y, si tampoco existe, la fecha actual del reloj.
     */
    public static NormativeProfile of(IntentoTest intento, Clock clock) {
        AsignacionTest assignment = intento.getAsignacion();
        Integer age = assignment.getEdadRegistradaAplicacion() == null ? null
                : Integer.valueOf(assignment.getEdadRegistradaAplicacion());
        Short sexId = assignment.getSexoAplicacion() == null ? null : assignment.getSexoAplicacion().getId();
        Short careerId = assignment.getCarreraAplicacion() == null ? null : assignment.getCarreraAplicacion().getId();
        LocalDate date = intento.getFinalizadoEn() != null ? intento.getFinalizadoEn().toLocalDate()
                : intento.getIniciadoEn() != null ? intento.getIniciadoEn().toLocalDate() : LocalDate.now(clock);
        return new NormativeProfile(age, sexId, careerId, date);
    }
}
