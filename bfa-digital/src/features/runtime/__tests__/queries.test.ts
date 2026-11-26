import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { queryClient } from "../../../api/queryClient";
import { useParticipantAuth } from "../../../store/participantAuth";
import { server } from "../../../test/msw/server";
import { evaluationGuard } from "../evaluation-guard";
import { ensureCurrentEvaluation } from "../queries";

const API = "http://localhost:8080";

const evaluationWire = {
  id: null,
  assignmentId: 42,
  sessionId: 7,
  participantDisplayName: "Ana Pérez",
  sessionName: "Sesión",
  sessionStatus: "ABIERTA",
  pausedAt: null,
  attemptStatus: "NO_INICIADO",
  subtests: [],
};

describe("ensureCurrentEvaluation (F2-FIX-7)", () => {
  beforeEach(() => {
    queryClient.clear();
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
  });
  afterEach(() => {
    queryClient.clear();
    useParticipantAuth.getState().clear();
  });

  it("con la caché invalidada y un 503, el refetch NO se reintenta: exactamente 2 solicitudes (la invalidada + un refetch) con el QueryClient de producción", async () => {
    let calls = 0;
    let failing = false;
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => {
        calls += 1;
        if (failing) {
          return HttpResponse.json(
            { success: false, data: null, error: { code: "SERVICE_UNAVAILABLE", message: "x" }, correlationId: "c" },
            { status: 503 },
          );
        }
        return HttpResponse.json({ success: true, data: evaluationWire, correlationId: "c" });
      }),
    );

    // 1.ª solicitud: siembra la caché con un ticket vigente.
    const first = await ensureCurrentEvaluation(queryClient, 42);
    expect(first).not.toBeNull();
    expect(calls).toBe(1);

    // Se oculta la pestaña: el dato en caché queda invalidado y el servidor responde 503.
    evaluationGuard.invalidateForVisibility();
    failing = true;
    const second = await ensureCurrentEvaluation(queryClient, 42);

    expect(second).toBeNull();
    expect(calls).toBe(2);
    // Margen para que, sin el fix, falle por el conteo (los reintentos tardan ~3 s) y no por el timeout del test.
  }, 15_000);
});
