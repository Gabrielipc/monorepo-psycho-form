package com.uam.psychoform.scoring.service;

import com.uam.psychoform.assessment.model.EstadoIntento;
import com.uam.psychoform.assessment.model.IntentoTest;
import com.uam.psychoform.assessment.repository.IntentoTestRepository;
import com.uam.psychoform.instrument.model.EstadoVersionTest;
import com.uam.psychoform.instrument.model.VersionTest;
import com.uam.psychoform.scoring.model.Resultado;
import com.uam.psychoform.scoring.repository.ResultadoRepository;
import com.uam.psychoform.scoring.service.strategy.ScoringContext;
import com.uam.psychoform.scoring.service.strategy.ScoringOutcome;
import com.uam.psychoform.scoring.service.strategy.ScoringStrategy;
import com.uam.psychoform.security.CurrentActor;
import com.uam.psychoform.security.SecurityPermissions;
import com.uam.psychoform.security.model.Usuario;
import com.uam.psychoform.security.repository.UsuarioRepository;
import jakarta.persistence.EntityNotFoundException;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Fachada de calificacion: valida el intento, delega el calculo en la estrategia de la version y persiste el
 * resultado. No conoce ninguna estrategia concreta.
 */
@Service
@Transactional(readOnly = true)
public class ScoringService {
    private final IntentoTestRepository intentos;
    private final ResultadoRepository resultados;
    private final ScoringStrategyRegistry registry;
    private final ScoringContextLoader loader;
    private final ScoringResultWriter writer;
    private final UsuarioRepository usuarios;
    private final CurrentActor currentActor;

    public ScoringService(IntentoTestRepository intentos, ResultadoRepository resultados,
            ScoringStrategyRegistry registry, ScoringContextLoader loader, ScoringResultWriter writer,
            UsuarioRepository usuarios, CurrentActor currentActor) {
        this.intentos = intentos;
        this.resultados = resultados;
        this.registry = registry;
        this.loader = loader;
        this.writer = writer;
        this.usuarios = usuarios;
        this.currentActor = currentActor;
    }

    /** Califica el intento. Es idempotente: si ya hay resultado, solo garantiza sus revisiones pendientes. */
    @Transactional
    @PreAuthorize(SecurityPermissions.CALIFICACION_EJECUTAR)
    public Resultado scoreAttempt(long intentoId) {
        // El bloqueo va primero: una segunda llamada concurrente espera y encuentra el resultado ya creado.
        IntentoTest intento = intentos.findByIdForUpdate(intentoId)
                .orElseThrow(() -> new EntityNotFoundException("Intento no encontrado: " + intentoId));
        return resultados.findByIntentoId(intentoId)
                .map(writer::ensurePendingReviews)
                .orElseGet(() -> calculate(intento));
    }

    private Resultado calculate(IntentoTest intento) {
        if (intento.getEstado() != EstadoIntento.COMPLETADO) {
            throw new IllegalStateException("El intento debe estar finalizado para calificar");
        }
        VersionTest version = intento.getAsignacion().getSesionAplicacion().getVersionTest();
        if (version.getEstado() != EstadoVersionTest.PUBLICADO) {
            throw new IllegalStateException("La version del test no esta publicada");
        }
        ScoringStrategy strategy = registry.require(version.getEstrategiaCalificacion());
        UUID actorId = currentActor.usuarioId();
        Usuario actor = usuarios.findById(actorId)
                .orElseThrow(() -> new EntityNotFoundException("Usuario autenticado no encontrado: " + actorId));
        ScoringContext context = loader.load(intento);
        ScoringOutcome outcome = strategy.score(context);
        ScoringOutcomeValidator.validate(outcome, context);
        return writer.write(intento, version.getEstrategiaCalificacion(), actor, outcome, context);
    }
}
