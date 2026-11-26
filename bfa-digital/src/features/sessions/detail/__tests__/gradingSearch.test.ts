import { describe, expect, it } from "vitest";
import { gradingSearchSchema, pickSessionId, resolveGradingSelection } from "../gradingSearch";

describe("gradingSearchSchema", () => {
  it("acepta sessionId y attemptId (también como texto de la URL)", () => {
    expect(gradingSearchSchema.parse({ sessionId: "7", attemptId: 9002 })).toEqual({ sessionId: 7, attemptId: 9002 });
  });

  it("valida cada valor por separado: uno inválido se ignora y el otro se conserva", () => {
    expect(gradingSearchSchema.parse({ sessionId: "abc", attemptId: 5 })).toEqual({ sessionId: undefined, attemptId: 5 });
    expect(gradingSearchSchema.parse({ sessionId: 3, attemptId: -1 })).toEqual({ sessionId: 3, attemptId: undefined });
    expect(gradingSearchSchema.parse({ sessionId: 0, attemptId: 1.5 })).toEqual({ sessionId: undefined, attemptId: undefined });
    expect(gradingSearchSchema.parse({})).toEqual({});
  });
});

describe("pickSessionId (preselección de la pantalla de calificaciones)", () => {
  const sessions = [{ id: "1" }, { id: "2" }, { id: "3" }];

  it("preselecciona la sesión pedida si existe en la lista", () => {
    expect(pickSessionId(sessions, 3, "")).toBe("3");
  });

  it("sin pedido (o pedido inexistente) cae en la primera sesión", () => {
    expect(pickSessionId(sessions, undefined, "")).toBe("1");
    expect(pickSessionId(sessions, 99, "")).toBe("1");
  });

  it("respeta la selección vigente si sigue en la lista y no pisa la pedida mientras la lista no cargó", () => {
    expect(pickSessionId(sessions, 3, "2")).toBe("2");
    expect(pickSessionId([], 3, "3")).toBe("3");
  });

  it("si la selección vigente ya no existe usa la pedida o la primera", () => {
    expect(pickSessionId(sessions, 2, "9")).toBe("2");
    expect(pickSessionId(sessions, undefined, "9")).toBe("1");
  });
});

describe("resolveGradingSelection (preselección pendiente hasta lista fresca)", () => {
  it("con caché [1] y lista fresca [1,2] pidiendo 2: espera, luego selecciona 2 y libera el pendiente", () => {
    const cached = [{ id: "1" }];
    const fresh = [{ id: "1" }, { id: "2" }];
    const during = resolveGradingSelection({ sessions: cached, pending: 2, current: "2", listFresh: false });
    expect(during).toEqual({ sessionId: "2", settled: false, notFound: false });
    const after = resolveGradingSelection({ sessions: fresh, pending: 2, current: "2", listFresh: true });
    expect(after).toEqual({ sessionId: "2", settled: true, notFound: false });
    // Liberado el pendiente rige la selección manual.
    expect(resolveGradingSelection({ sessions: fresh, pending: undefined, current: "1", listFresh: true }).sessionId).toBe("1");
  });

  it("si la lista fresca no contiene la sesión pedida, avisa (notFound) y cae en una válida", () => {
    const r = resolveGradingSelection({ sessions: [{ id: "1" }], pending: 9, current: "9", listFresh: true });
    expect(r).toEqual({ sessionId: "1", settled: true, notFound: true });
  });

  it("lista fresca vacía: limpia la selección vigente y libera el pendiente", () => {
    expect(resolveGradingSelection({ sessions: [], pending: undefined, current: "1", listFresh: true })).toEqual({
      sessionId: "",
      settled: true,
      notFound: false,
    });
    expect(resolveGradingSelection({ sessions: [], pending: 9, current: "9", listFresh: true })).toEqual({
      sessionId: "",
      settled: true,
      notFound: true,
    });
    // Lista vacía NO fresca (caché aún sin cargar): se conserva la selección.
    expect(resolveGradingSelection({ sessions: [], pending: undefined, current: "1", listFresh: false }).sessionId).toBe("1");
  });
});
