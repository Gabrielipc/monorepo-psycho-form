package com.uam.psychoform.scoring.service.strategy;

import java.time.LocalDate;

/** Datos del participante al momento de la aplicacion, usados para elegir el baremo. Cualquier dato puede ser nulo. */
public record NormativeProfile(Integer age, Short sexId, Short careerId, LocalDate applicationDate) {
}
