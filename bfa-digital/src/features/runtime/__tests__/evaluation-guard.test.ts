import { describe, expect, it } from "vitest";
import { createEvaluationGuard, evaluationGuard, isTicketCurrent } from "../evaluation-guard";

describe("evaluation-guard (F2-FIX-4)", () => {
  it("una solicitud vieja que llega DESPUÉS de una nueva ya aplicada no es vigente (orden de inicio, no de llegada)", () => {
    const guard = createEvaluationGuard(() => "42:jwt");
    const older = guard.startRequest();
    const newer = guard.startRequest();
    // La nueva llega primero y se aplica.
    expect(guard.isCurrent(newer)).toBe(true);
    guard.markApplied(newer);
    // La vieja llega después: no pisa.
    expect(guard.isCurrent(older)).toBe(false);
  });

  it("una solicitud vieja que llega ANTES que la nueva sí se aplica y la nueva sigue vigente", () => {
    const guard = createEvaluationGuard(() => "42:jwt");
    const older = guard.startRequest();
    const newer = guard.startRequest();
    expect(guard.isCurrent(older)).toBe(true);
    guard.markApplied(older);
    expect(guard.isCurrent(newer)).toBe(true);
  });

  it("ocultar la pestaña invalida lo iniciado antes; lo iniciado después es vigente", () => {
    const guard = createEvaluationGuard(() => "42:jwt");
    const before = guard.startRequest();
    guard.invalidateForVisibility();
    const after = guard.startRequest();
    expect(guard.isCurrent(before)).toBe(false);
    expect(guard.isCurrent(after)).toBe(true);
  });

  it("un cambio de dueño (asignación o token) invalida las solicitudes en vuelo", () => {
    let owner = "42:jwt-a";
    const guard = createEvaluationGuard(() => owner);
    const ticket = guard.startRequest();
    owner = "42:jwt-b";
    expect(guard.isCurrent(ticket)).toBe(false);
    expect(guard.isCurrent(guard.startRequest())).toBe(true);
  });

  it("asocia resultados y errores a su ticket por identidad; sin ticket (dato local) es vigente", () => {
    const guard = createEvaluationGuard(() => "42:jwt");
    const ticket = guard.startRequest();
    const data = { assignmentId: 42 };
    const error = new Error("boom");
    guard.register(data, ticket);
    guard.register(error, ticket);
    expect(guard.ticketOf(data)).toBe(ticket);
    expect(guard.ticketOf(error)).toBe(ticket);
    expect(guard.ticketOf({ assignmentId: 42 })).toBeUndefined();
    expect(guard.ticketOf("texto")).toBeUndefined();
    expect(guard.ticketOf(null)).toBeUndefined();
    expect(guard.isCurrent(undefined)).toBe(true);
  });
});

describe("isTicketCurrent (F2-FIX-6)", () => {
  it("un dato cuya solicitud se invalidó por visibilidad deja de ser vigente; un dato sin ticket sí lo es", () => {
    const data = { assignmentId: 42 };
    evaluationGuard.register(data, evaluationGuard.startRequest());
    expect(isTicketCurrent(data)).toBe(true);
    evaluationGuard.invalidateForVisibility();
    expect(isTicketCurrent(data)).toBe(false);
    expect(isTicketCurrent({ assignmentId: 42 })).toBe(true);
    // Una solicitud iniciada después de la ocultación es vigente.
    const later = { assignmentId: 42 };
    evaluationGuard.register(later, evaluationGuard.startRequest());
    expect(isTicketCurrent(later)).toBe(true);
  });
});
