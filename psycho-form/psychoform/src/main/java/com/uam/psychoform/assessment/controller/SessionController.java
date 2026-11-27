package com.uam.psychoform.assessment.controller;

import com.uam.psychoform.assessment.dto.*;

import com.uam.psychoform.assessment.service.*;
import com.uam.psychoform.dto.ApiResponse;
import com.uam.psychoform.dto.EntityView;
import com.uam.psychoform.security.SecurityPermissions;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/sesiones")
public class SessionController {
    private final SessionManagementService management;
    private final SesionAplicacionService lifecycle;
    private final ParticipantRuntimeService runtime;

    public SessionController(SessionManagementService management, SesionAplicacionService lifecycle,
            ParticipantRuntimeService runtime) {
        this.management = management;
        this.lifecycle = lifecycle;
        this.runtime = runtime;
    }

    @GetMapping
    @PreAuthorize(SecurityPermissions.SESION_LEER)
    public ApiResponse<?> list() {
        return ApiResponse.ok(EntityView.of(management.listSessions()));
    }

    @GetMapping("/{id}")
    @PreAuthorize(SecurityPermissions.SESION_LEER)
    public ApiResponse<?> detail(@PathVariable Long id) {
        return ApiResponse.ok(EntityView.of(management.getSession(id)));
    }

    @PostMapping
    @PreAuthorize(SecurityPermissions.SESION_CREAR)
    public ApiResponse<?> create(@Valid @RequestBody CreateSessionRequest request) {
        return ApiResponse.ok(EntityView.of(management.create(new SessionManagementService.CreateSessionCommand(request.versionTestId(),
                request.code(), request.name(), request.description(), request.scheduledStart(), request.scheduledEnd(),
                request.location()))));
    }

    @PostMapping("/{id}/activar")
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public ApiResponse<?> activate(@PathVariable Long id) {
        return ApiResponse.ok(EntityView.of(lifecycle.abrir(id)));
    }

    @PostMapping("/{id}/pausar")
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public ApiResponse<?> pause(@PathVariable Long id,
            @Valid @RequestBody(required = false) PauseSessionRequest request) {
        return ApiResponse.ok(EntityView.of(lifecycle.pausar(id, request == null ? null : request.motivo())));
    }

    @PostMapping("/{id}/reanudar")
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public ApiResponse<?> resume(@PathVariable Long id) {
        return ApiResponse.ok(EntityView.of(lifecycle.reanudar(id)));
    }

    @GetMapping("/{id}/pausas")
    @PreAuthorize(SecurityPermissions.SESION_LEER)
    public ApiResponse<?> pauses(@PathVariable Long id) {
        return ApiResponse.ok(lifecycle.listarPausas(id));
    }

    @PostMapping("/{id}/cerrar")
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public ApiResponse<?> close(@PathVariable Long id) {
        return ApiResponse.ok(EntityView.of(lifecycle.cerrar(id)));
    }

    @PostMapping("/{id}/cancelar")
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public ApiResponse<?> cancel(@PathVariable Long id) {
        return ApiResponse.ok(EntityView.of(lifecycle.cancelar(id)));
    }

    @PutMapping("/{id}/subtests")
    @PreAuthorize(SecurityPermissions.SESION_CREAR)
    public ApiResponse<?> subtests(@PathVariable Long id, @Valid @RequestBody List<SessionSubtestRequest> request) {
        return ApiResponse.ok(EntityView.of(management.replaceSubtests(id, request.stream()
                .map(r -> new SessionManagementService.SessionSubtestCommand(r.subtestId(), r.order(),
                        r.timeLimitSeconds(), r.randomizeItems(), r.randomizeOptions()))
                .toList())));
    }

    @PostMapping("/{id}/asignaciones")
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public ApiResponse<?> assign(@PathVariable Long id, @Valid @RequestBody AssignParticipantRequest request) {
        return ApiResponse.ok(runtime.assignParticipant(new ParticipantRuntimeService.AssignParticipantCommand(id,
                request.participantId(), Duration.ofHours(request.ttlHours() == null ? 8 : request.ttlHours()))));
    }

    @GetMapping("/{id}/asignaciones")
    @PreAuthorize(SecurityPermissions.SESION_LEER)
    public ApiResponse<?> getAssignments(@PathVariable Long id) {
        return ApiResponse.ok(runtime.getAssignmentsForSession(id));
    }

    @PostMapping("/{id}/asignaciones/{assignmentId}/revocar")
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public ApiResponse<Void> revokeAssignment(@PathVariable Long id, @PathVariable Long assignmentId) {
        runtime.revokeAssignment(id, assignmentId);
        return ApiResponse.ok(null);
    }

    @PostMapping("/{id}/asignaciones/{assignmentId}/regenerar-token")
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public ApiResponse<?> regenerateToken(@PathVariable Long id, @PathVariable Long assignmentId,
            @Valid @RequestBody(required = false) RegenerateTokenRequest request) {
        Integer ttlHours = request == null ? null : request.ttlHours();
        return ApiResponse.ok(runtime.regenerateAssignmentToken(id, assignmentId,
                Duration.ofHours(ttlHours == null ? 8 : ttlHours)));
    }

    @PostMapping("/{id}/incidencias")
    @PreAuthorize(SecurityPermissions.SESION_APLICAR)
    public ApiResponse<Void> incidence(@PathVariable Long id, @Valid @RequestBody IncidenceRequest request) {
        runtime.recordIncidence(id, new ParticipantRuntimeService.IncidenceCommand(request.participantId(), request.text()));
        return ApiResponse.ok(null);
    }

    public record RegenerateTokenRequest(@Min(1) @Max(72) Integer ttlHours) {
    }

    public record IncidenceRequest(UUID participantId, String text) {
    }
}
