import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";

import { routeTree } from "../../../routeTree.gen";
import { useParticipantAuth } from "../../../store/participantAuth";
import { server } from "../../../test/msw/server";
import { setNavigator } from "../../../api/client";
import { useRuntimeDraft } from "../draft";
import { resetDraftSyncForTests } from "../draft/sync";

const API = "http://localhost:8080";

function ok<T>(data: T, status = 200) {
  return HttpResponse.json({ success: true, data, correlationId: "test-cid" }, { status });
}

function apiErr(status: number, code: string, message: string) {
  return HttpResponse.json(
    { success: false, data: null, error: { code, message }, correlationId: "test-err" },
    { status },
  );
}

interface SubtestWire {
  subtestId: number;
  code: string;
  name: string;
  instructions: string | null;
  order: number;
  timeLimitSeconds: number | null;
  randomizeItems: boolean;
  randomizeOptions: boolean;
  status: string;
  startedAt?: string | null;
  remainingSeconds?: number | null;
  paused?: boolean;
  serverNow?: string | null;
  items: Array<{
    itemId: number;
    code: string;
    itemType: string;
    responseType: string;
    prompt: string;
    instruction: string | null;
    order: number;
    images: Array<{ imageId: number; url: string; altText?: string; order: number }>;
    options: Array<{
      optionId: number;
      code: string;
      text: string;
      order: number;
      images: Array<{ imageId: number; url: string; altText?: string; order: number }>;
    }>;
    savedAnswer?: {
      selectedOptionIds: number[];
      textAnswer?: string | null;
      numericAnswer?: number | null;
      timeUsedSeconds?: number | null;
    } | null;
  }>;
}

function makeSubtestWire(
  id: number,
  order: number,
  status = "NO_INICIADO",
  extra: Partial<SubtestWire> = {},
): SubtestWire {
  return {
    subtestId: id,
    code: `ST-${id}`,
    name: `Subtest ${id}`,
    instructions: `Lea las instrucciones del subtest ${id}.`,
    order,
    timeLimitSeconds: 600,
    randomizeItems: false,
    randomizeOptions: false,
    status,
    items: [
      {
        itemId: id * 100 + 1,
        code: `IT-${id}-1`,
        itemType: "SOLO_TEXTO",
        responseType: "OPCION_UNICA",
        prompt: `Pregunta 1 del subtest ${id}`,
        instruction: null,
        order: 1,
        images: [],
        options: [
          { optionId: id * 1000 + 1, code: "A", text: "Opción A1", order: 1, images: [] },
          { optionId: id * 1000 + 2, code: "B", text: "Opción B1", order: 2, images: [] },
        ],
      },
      {
        itemId: id * 100 + 2,
        code: `IT-${id}-2`,
        itemType: "SOLO_TEXTO",
        responseType: "OPCION_UNICA",
        prompt: `Pregunta 2 del subtest ${id}`,
        instruction: null,
        order: 2,
        images: [],
        options: [
          { optionId: id * 1000 + 3, code: "A", text: "Opción A2", order: 1, images: [] },
          { optionId: id * 1000 + 4, code: "B", text: "Opción B2", order: 2, images: [] },
        ],
      },
    ],
    ...extra,
  };
}

function makeEvaluationWire(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    assignmentId: 42,
    sessionId: 7,
    participantDisplayName: "Ana Pérez",
    sessionName: "Sesión Cohorte 2026",
    sessionStatus: "ABIERTA",
    pausedAt: null,
    attemptStatus: "EN_PROGRESO",
    subtests: [makeSubtestWire(10, 1, "EN_PROGRESO"), makeSubtestWire(20, 2, "NO_INICIADO")],
    ...overrides,
  };
}

async function renderRunnerAt(initialPath: string, queryClient?: QueryClient) {
  const qc =
    queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
  const history = createMemoryHistory({ initialEntries: [initialPath] });
  const router = createRouter({
    routeTree,
    history,
    context: { queryClient: qc },
  });
  setNavigator(
    (options) => router.navigate(options as Parameters<typeof router.navigate>[0]),
    () => router.state.location.href,
  );
  await router.load();
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, history, queryClient: qc };
}

describe("Runner del participante (R-04)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.stubGlobal("alert", vi.fn(() => {
      throw new Error("window.alert está prohibido");
    }));
    vi.stubGlobal("confirm", vi.fn(() => {
      throw new Error("window.confirm está prohibido");
    }));
    sessionStorage.clear();
    useParticipantAuth.getState().clear();
    resetDraftSyncForTests();
    useRuntimeDraft.getState().clearDraft();
  });

  afterEach(() => {
    setNavigator(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetDraftSyncForTests();
    useRuntimeDraft.getState().clearDraft();
    useParticipantAuth.getState().clear();
    sessionStorage.clear();
  });

  it("entrada por /evaluacion/$code canjea el token con replace sin dejarlo en el historial ni en el DOM", async () => {
    let seenValidate: unknown;
    server.use(
      http.post(`${API}/acceso-participante/validar`, async ({ request }) => {
        seenValidate = await request.json();
        return ok({
          assignmentId: 42,
          participantId: "550e8400-e29b-41d4-a716-446655440000",
          accessToken: "jwt-secret-token",
          tokenType: "Bearer",
        });
      }),
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(makeEvaluationWire({ id: null, attemptStatus: "NO_INICIADO", subtests: [makeSubtestWire(10, 1)] })),
      ),
    );

    const { router, history, container } = await renderRunnerAt("/evaluacion/42-mi-token-secreto");

    expect(await screen.findByText("Bienvenido/a a la evaluación BFA Digital")).toBeInTheDocument();
    expect(seenValidate).toEqual({ assignmentId: 42, token: "mi-token-secreto" });
    expect(router.state.location.pathname).toBe("/evaluacion/sesion");
    expect(history.location.pathname).toBe("/evaluacion/sesion");
    // El token fue reemplazado en el historial (no queda atrás) y jamás aparece en el DOM
    expect(history.length).toBe(1);
    expect(container.textContent).not.toContain("mi-token-secreto");
    expect(container.textContent).not.toContain("jwt-secret-token");
    expect(useParticipantAuth.getState()).toMatchObject({
      token: "jwt-secret-token",
      assignmentId: 42,
    });
  });

  it("acceso manual por /evaluacion/acceso guarda auth, limpia caché previa y navega sin token en URL", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["runtime", "evaluation", 99], makeEvaluationWire({ assignmentId: 99 }));

    server.use(
      http.post(`${API}/acceso-participante/validar`, () =>
        ok({
          assignmentId: 42,
          participantId: "uuid-42",
          accessToken: "jwt-42",
          tokenType: "Bearer",
        }),
      ),
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(makeEvaluationWire({ id: null, attemptStatus: "NO_INICIADO", subtests: [makeSubtestWire(10, 1)] })),
      ),
    );

    const { router } = await renderRunnerAt("/evaluacion/acceso", qc);

    const input = await screen.findByLabelText("Código de acceso");
    fireEvent.change(input, { target: { value: "42-clave-manual" } });
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }));

    expect(await screen.findByText("Bienvenido/a a la evaluación BFA Digital")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/evaluacion/sesion");
    expect(qc.getQueryData(["runtime", "evaluation", 99])).toBeUndefined();
  });

  it("guards de orden: bloquea sin sesión, subtest futuro, COMPLETADO, ANULADO, NO_INICIADO y hace clampOrdinal", async () => {
    // 1. Sin sesión -> redirige a /evaluacion/acceso
    const unauth = await renderRunnerAt("/evaluacion/sesion");
    await waitFor(() => expect(unauth.router.state.location.pathname).toBe("/evaluacion/acceso"));
    unauth.unmount();

    // Con sesión activa: subtest 10 COMPLETADO, 20 ANULADO, 30 EN_PROGRESO (2 ítems), 40 NO_INICIADO (futuro)
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(10, 1, "COMPLETADO"),
              makeSubtestWire(20, 2, "ANULADO"),
              makeSubtestWire(30, 3, "EN_PROGRESO", {
                startedAt: new Date(Date.now() - 10_000).toISOString(),
                remainingSeconds: 590,
                serverNow: new Date().toISOString(),
              }),
              makeSubtestWire(40, 4, "NO_INICIADO"),
            ],
          }),
        ),
      ),
    );

    // 2. Subtest COMPLETADO -> redirige a /evaluacion/sesion
    const completed = await renderRunnerAt("/evaluacion/subtests/10/instrucciones");
    await waitFor(() => expect(completed.router.state.location.pathname).toBe("/evaluacion/sesion"));
    completed.unmount();

    // 3. Subtest ANULADO -> redirige a /evaluacion/sesion y la lista lo muestra no abrible
    const annulled = await renderRunnerAt("/evaluacion/subtests/20/instrucciones");
    await waitFor(() => expect(annulled.router.state.location.pathname).toBe("/evaluacion/sesion"));
    const annulledCard = (await screen.findByText("Subtest 20")).closest("[data-subtest-id]");
    expect(annulledCard).not.toBeNull();
    expect(within(annulledCard as HTMLElement).getByRole("button", { name: "Anulado" })).toBeDisabled();
    annulled.unmount();

    // 4. Subtest futuro (40) mientras 30 sigue EN_PROGRESO -> redirige a /evaluacion/sesion
    const future = await renderRunnerAt("/evaluacion/subtests/40/instrucciones");
    await waitFor(() => expect(future.router.state.location.pathname).toBe("/evaluacion/sesion"));
    future.unmount();

    // 5. Subtest NO_INICIADO directo a /items/1 -> redirige a instrucciones
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [makeSubtestWire(30, 1, "NO_INICIADO")],
          }),
        ),
      ),
    );
    const notStartedItem = await renderRunnerAt("/evaluacion/subtests/30/items/1");
    await waitFor(() =>
      expect(notStartedItem.router.state.location.pathname).toBe(
        "/evaluacion/subtests/30/instrucciones",
      ),
    );
    notStartedItem.unmount();

    // 6. Ordinal fuera de rango (99) -> clampOrdinal(99, 2) = 2
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(30, 1, "EN_PROGRESO", {
                startedAt: new Date(Date.now() - 5_000).toISOString(),
                remainingSeconds: 595,
                serverNow: new Date().toISOString(),
              }),
            ],
          }),
        ),
      ),
    );
    const outOfRange = await renderRunnerAt("/evaluacion/subtests/30/items/99");
    await waitFor(() =>
      expect(outOfRange.router.state.location.pathname).toBe("/evaluacion/subtests/30/items/2"),
    );
    expect(await screen.findByText("Pregunta 2 del subtest 30")).toBeInTheDocument();
  });

  it("recarga a mitad de un subtest EN_PROGRESO conserva el deadline del servidor sin re-llamar startSubtest", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const T0 = Date.parse("2026-11-25T12:00:00.000Z");
    vi.setSystemTime(T0);

    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let startSubtestCalls = 0;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(10, 1, "EN_PROGRESO", {
                timeLimitSeconds: 600,
                startedAt: "2026-11-25T11:55:00.000Z",
                remainingSeconds: 300,
                paused: false,
                serverNow: "2026-11-25T12:00:00.000Z",
                items: [],
              }),
            ],
          }),
        ),
      ),
      http.get(`${API}/intentos/101/subtests/10/items`, () =>
        ok(makeSubtestWire(10, 1, "EN_PROGRESO")),
      ),
      http.post(`${API}/intentos/101/subtests/10/iniciar`, () => {
        startSubtestCalls += 1;
        return ok({ id: 1, estado: "EN_PROGRESO" });
      }),
    );

    await renderRunnerAt("/evaluacion/subtests/10/items/2");

    expect(await screen.findByText("Pregunta 2 del subtest 10")).toBeInTheDocument();
    expect(startSubtestCalls).toBe(0);
    const timer = screen.getByRole("timer");
    expect(timer).toHaveTextContent("05:00");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByRole("timer")).toHaveTextContent("04:55");
  });

  it("deadline vencido ejecuta flushBeforeFinish y finishSubtest aunque falle el flush, sin atascar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const T0 = Date.parse("2026-11-25T12:00:00.000Z");
    vi.setSystemTime(T0);

    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let bulkCalls = 0;
    let finishBody: unknown = null;
    let finished = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(10, 1, finished ? "COMPLETADO" : "EN_PROGRESO", {
                timeLimitSeconds: 10,
                startedAt: "2026-11-25T11:59:52.000Z",
                remainingSeconds: 2,
                paused: false,
                serverNow: "2026-11-25T12:00:00.000Z",
              }),
              makeSubtestWire(20, 2, "NO_INICIADO"),
            ],
          }),
        ),
      ),
      http.put(`${API}/intentos/101/items/1001/respuesta`, () =>
        apiErr(500, "SERVER_ERROR", "Fallo temporal"),
      ),
      http.post(`${API}/intentos/101/respuestas/bulk-sync`, () => {
        bulkCalls += 1;
        return apiErr(503, "UNAVAILABLE", "Sin conexión al flush");
      }),
      http.post(`${API}/intentos/101/subtests/10/finalizar`, async ({ request }) => {
        finishBody = await request.json();
        finished = true;
        return ok({
          id: 305,
          intentoId: 101,
          subtestId: 10,
          estado: "COMPLETADO",
          tiempoUsadoSegundos: 10,
        });
      }),
    );

    const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

    // Selecciona una opción que falla al guardar -> queda en cola pendiente
    fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));

    // Avanza 3 segundos para vencer el deadline de 2s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/sesion"));
    expect(bulkCalls).toBeGreaterThanOrEqual(1);
    expect(finishBody).toEqual({ timeSeconds: 10 });
    expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
  });

  it("PAUSADA congela el cronómetro y ABIERTA reanuda automáticamente llamando resumeSync", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const T0 = Date.parse("2026-11-25T12:00:00.000Z");
    vi.setSystemTime(T0);

    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let phase: "open1" | "paused" | "open2" = "open1";
    let syncedAfterResume = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => {
        if (phase === "open1") {
          return ok(
            makeEvaluationWire({
              sessionStatus: "ABIERTA",
              subtests: [
                makeSubtestWire(10, 1, "EN_PROGRESO", {
                  timeLimitSeconds: 600,
                  startedAt: "2026-11-25T11:55:00.000Z",
                  remainingSeconds: 300,
                  paused: false,
                  serverNow: new Date(Date.now()).toISOString(),
                }),
              ],
            }),
          );
        }
        if (phase === "paused") {
          return ok(
            makeEvaluationWire({
              sessionStatus: "PAUSADA",
              pausedAt: new Date(Date.now()).toISOString(),
              subtests: [
                makeSubtestWire(10, 1, "EN_PROGRESO", {
                  timeLimitSeconds: 600,
                  startedAt: "2026-11-25T11:55:00.000Z",
                  remainingSeconds: 290,
                  paused: true,
                  serverNow: new Date(Date.now()).toISOString(),
                }),
              ],
            }),
          );
        }
        return ok(
          makeEvaluationWire({
            sessionStatus: "ABIERTA",
            subtests: [
              makeSubtestWire(10, 1, "EN_PROGRESO", {
                timeLimitSeconds: 600,
                startedAt: "2026-11-25T11:55:00.000Z",
                remainingSeconds: 290,
                paused: false,
                serverNow: new Date(Date.now()).toISOString(),
              }),
            ],
          }),
        );
      }),
      http.put(`${API}/intentos/101/items/1001/respuesta`, () =>
        apiErr(409, "SESION_PAUSADA", "Sesión pausada"),
      ),
      http.post(`${API}/intentos/101/respuestas/bulk-sync`, () => {
        syncedAfterResume = true;
        return ok([{ itemId: 1001, status: "GUARDADA", code: null, answerId: 55 }]);
      }),
    );

    await renderRunnerAt("/evaluacion/subtests/10/items/1");
    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

    // Pasa a pausada vía polling (10s)
    phase = "paused";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(await screen.findByText("Evaluación pausada")).toBeInTheDocument();
    expect(screen.getByText(/Tiempo restante congelado: 04:50/)).toBeInTheDocument();

    // Durante la pausa el tiempo NO avanza aunque pasen 20s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(screen.getByText(/Tiempo restante congelado: 04:50/)).toBeInTheDocument();

    // Simulamos respuesta en cola retenida durante la pausa y luego reanudación
    useRuntimeDraft.getState().setAnswerLocal(1001, { kind: "OPCION_UNICA", optionId: 10001 }, 4, 10);
    phase = "open2";

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveTextContent("04:50");
    await waitFor(() => expect(syncedAfterResume).toBe(true));
  });

  it.each([
    ["TOKEN_EXPIRADO", /expirado/i],
    ["SESION_FINALIZADA", /finalizada/i],
    ["ASIGNACION_NO_OPERABLE", /no operable/i],
  ])("bloqueo 409 %s muestra pantalla bloqueada clara", async (code, expectedRegex) => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => apiErr(409, code, "Bloqueado")),
    );

    await renderRunnerAt("/evaluacion/sesion");
    expect(await screen.findByRole("heading", { name: expectedRegex })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver al inicio" })).toBeInTheDocument();
  });

  it("403 en /yo transiciona a ACCESS_REVOKED", async () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        apiErr(403, "FORBIDDEN", "Acceso revocado"),
      ),
    );

    await renderRunnerAt("/evaluacion/sesion");
    expect(await screen.findByRole("heading", { name: "Acceso revocado" })).toBeInTheDocument();
  });

  it("navegación por teclado ←/→ entre ítems sin interferir con campos editables ni modales", async () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    const subtestWithOpenText = makeSubtestWire(10, 1, "EN_PROGRESO", {
      items: [
        {
          itemId: 1001,
          code: "IT-1",
          itemType: "SOLO_TEXTO",
          responseType: "OPCION_UNICA",
          prompt: "Ítem uno",
          instruction: null,
          order: 1,
          images: [],
          options: [
            { optionId: 1, code: "A", text: "Uno", order: 1, images: [] },
            { optionId: 2, code: "B", text: "Dos", order: 2, images: [] },
          ],
        },
        {
          itemId: 1002,
          code: "IT-2",
          itemType: "SOLO_TEXTO",
          responseType: "TEXTO_ABIERTO",
          prompt: "Ítem dos abierto",
          instruction: null,
          order: 2,
          images: [],
          options: [],
        },
      ],
    });

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(makeEvaluationWire({ subtests: [subtestWithOpenText] })),
      ),
    );

    const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
    expect(await screen.findByRole("heading", { name: "Ítem uno" })).toBeInTheDocument();

    // → navega al ítem 2
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/2"),
    );
    expect(await screen.findByRole("heading", { name: "Ítem dos abierto" })).toBeInTheDocument();

    // En el textarea editable, ← NO debe navegar atrás
    const textarea = screen.getByRole("textbox");
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "ArrowLeft" });
    expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/2");

    // Fuera del textarea, ← navega de regreso al ítem 1
    (document.activeElement as HTMLElement | null)?.blur?.();
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1"),
    );
  });

  it("mide timeUsedSeconds y timeSeconds reales, muestra resumen con pendientes/rechazadas en ConfirmDialog y completa el intento", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const T0 = Date.parse("2026-11-25T12:00:00.000Z");
    vi.setSystemTime(T0);

    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });

    const putBodies: Array<{ itemId: number; timeUsedSeconds?: number }> = [];
    let finishSubtestPayload: unknown = null;
    let finishAttemptPayload: unknown = null;
    let attemptStarted = false;
    let subtestFinished = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            id: attemptStarted ? 101 : null,
            attemptStatus: attemptStarted ? "EN_PROGRESO" : "NO_INICIADO",
            subtests: [
              makeSubtestWire(10, 1, subtestFinished ? "COMPLETADO" : attemptStarted ? "EN_PROGRESO" : "NO_INICIADO", {
                timeLimitSeconds: null,
              }),
            ],
          }),
        ),
      ),
      http.post(`${API}/evaluacion-participante/iniciar`, () => {
        attemptStarted = true;
        return ok({
          id: 101,
          asignacionId: 42,
          iniciadoEn: new Date(Date.now()).toISOString(),
          estado: "EN_PROGRESO",
        });
      }),
      http.post(`${API}/intentos/101/subtests/10/iniciar`, () =>
        ok({
          id: 305,
          intentoId: 101,
          subtestId: 10,
          estado: "EN_PROGRESO",
          startedAt: new Date(Date.now()).toISOString(),
          timeLimitSeconds: null,
          serverNow: new Date(Date.now()).toISOString(),
        }),
      ),
      http.put(`${API}/intentos/101/items/1001/respuesta`, async ({ request }) => {
        const body = (await request.json()) as { itemId: number; timeUsedSeconds?: number };
        putBodies.push(body);
        return ok({
          id: 901,
          intentoId: 101,
          itemId: 1001,
          respondidoEn: new Date(Date.now()).toISOString(),
          tiempoUsadoSegundos: body.timeUsedSeconds ?? 0,
        });
      }),
      http.put(`${API}/intentos/101/items/1002/respuesta`, async ({ request }) => {
        const body = (await request.json()) as { itemId: number; timeUsedSeconds?: number };
        putBodies.push(body);
        return apiErr(400, "BAD_REQUEST", "Respuesta inválida en ítem 2");
      }),
      http.post(`${API}/intentos/101/subtests/10/finalizar`, async ({ request }) => {
        finishSubtestPayload = await request.json();
        subtestFinished = true;
        return ok({
          id: 305,
          intentoId: 101,
          subtestId: 10,
          estado: "COMPLETADO",
        });
      }),
      http.post(`${API}/intentos/101/finalizar`, async ({ request }) => {
        finishAttemptPayload = await request.json();
        return ok({
          id: 101,
          asignacionId: 42,
          estado: "COMPLETADO",
        });
      }),
    );

    const { router } = await renderRunnerAt("/evaluacion/sesion");

    // Bienvenida -> Iniciar evaluación
    fireEvent.click(await screen.findByRole("button", { name: /comenzar evaluación/i }));
    expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();

    // Lista -> Abrir instrucciones -> Iniciar subtest
    fireEvent.click(screen.getByRole("button", { name: /iniciar/i }));
    expect(await screen.findByText("Instrucciones del subtest")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /iniciar subtest/i }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/evaluacion/subtests/10/items/1"),
    );
    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

    // Espera 7 segundos en el ítem 1 antes de responder
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    fireEvent.click(screen.getByRole("radio", { name: /Opción A1/i }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toMatchObject({ itemId: 1001, selectedOptionIds: [10001], timeUsedSeconds: 7 });

    // Navega al ítem 2 (no lo responde, pero probamos el resumen previo con pendientes y rechazadas)
    fireEvent.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(await screen.findByText("Pregunta 2 del subtest 10")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    // Abre ConfirmDialog antes de responder ítem 2 para verificar listado de pendientes
    fireEvent.click(screen.getByRole("button", { name: "Finalizar subtest" }));
    const preDialog = await screen.findByRole("alertdialog");
    expect(preDialog).toHaveTextContent(/Ítems sin responder:\s*2/i);
    fireEvent.click(within(preDialog).getByRole("button", { name: "Seguir respondiendo" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    // Dispara rechazo definitivo en ítem 1002
    fireEvent.click(screen.getByRole("radio", { name: /Opción B2/i }));
    await waitFor(() => expect(putBodies).toHaveLength(2));
    expect(putBodies[1]).toMatchObject({ itemId: 1002, selectedOptionIds: [10004], timeUsedSeconds: 5 });

    // Abre ConfirmDialog de resumen previo a finalizar subtest
    fireEvent.click(screen.getByRole("button", { name: "Finalizar subtest" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/Respuestas rechazadas \(1\)/i);

    fireEvent.click(within(dialog).getByRole("button", { name: "Finalizar subtest" }));

    // Pasa a resumen de la evaluación porque era el único subtest
    expect(await screen.findByText("Resumen de su Evaluación")).toBeInTheDocument();
    expect(finishSubtestPayload).toEqual({ timeSeconds: 12 });

    // Confirmar entrega final del intento
    fireEvent.click(screen.getByRole("button", { name: "Finalizar evaluación" }));
    const finishDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(finishDialog).getByRole("button", { name: "Confirmar entrega final" }));

    expect(await screen.findByText("Evaluación Finalizada")).toBeInTheDocument();
    expect(finishAttemptPayload).toEqual({ timeSeconds: 12 });
  });

  it("muestra aviso descartable useDiscardNotice cuando se descartó cola de otra asignación e ignora STALE_PARTICIPANT", async () => {
    // Cola previa de asignación #11 en sessionStorage
    sessionStorage.setItem(
      "bfa-runtime-draft:11",
      JSON.stringify({
        v: 1,
        owner: { assignmentId: 11, attemptId: 500 },
        answers: {
          900: { value: { kind: "OPCION_UNICA", optionId: 1 }, version: 1, updatedAt: Date.now() },
        },
        queue: [{ itemId: 900, version: 1, notStartedAttempts: 0 }],
        rejectedAnswers: {},
        lastSyncAt: null,
      }),
    );

    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () => ok(makeEvaluationWire())),
    );

    await renderRunnerAt("/evaluacion/sesion");

    expect(
      await screen.findByText(/Se descartaron 1 respuesta pendiente de una sesión anterior \(asignación #11\)/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Entendido" }));
    expect(
      screen.queryByText(/Se descartaron 1 respuesta pendiente/i),
    ).not.toBeInTheDocument();
  });

  it("409 TIEMPO_AGOTADO al finalizar subtest cierra el subtest sin atascar al participante", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const T0 = Date.parse("2026-11-25T12:00:00.000Z");
    vi.setSystemTime(T0);

    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let closedByTimeout = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(10, 1, closedByTimeout ? "COMPLETADO" : "EN_PROGRESO", {
                timeLimitSeconds: 5,
                startedAt: "2026-11-25T11:59:56.000Z",
                remainingSeconds: 1,
                paused: false,
                serverNow: "2026-11-25T12:00:00.000Z",
              }),
              makeSubtestWire(20, 2, "NO_INICIADO"),
            ],
          }),
        ),
      ),
      http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
        closedByTimeout = true;
        return apiErr(409, "TIEMPO_AGOTADO", "El tiempo del subtest ya expiró");
      }),
    );

    const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/sesion"));
    expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
  });

  it("ignora STALE_PARTICIPANT silenciosamente si cambia el participante durante una petición en vuelo", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let resolveValidate: ((res: Response) => void) | null = null;
    server.use(
      http.post(`${API}/acceso-participante/validar`, () =>
        new Promise<Response>((resolve) => {
          resolveValidate = resolve;
        }),
      ),
    );

    const { unmount } = await renderRunnerAt("/evaluacion/42-token-lento");
    expect(screen.getByText("Validando acceso a la evaluación...")).toBeInTheDocument();

    // Desmonta (navega fuera) antes de que resuelva la validación tardía
    unmount();
    await act(async () => {
      resolveValidate?.(
        apiErr(0, "STALE_PARTICIPANT", "Descartado") as unknown as Response,
      );
      await Promise.resolve();
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("fallo 500 en finishSubtest (usuario) y finishAttempt recupera estado y permite reintentar", async () => {
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let failFinishSubtest = true;
    let failFinishAttempt = true;
    let subtestCompleted = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(10, 1, subtestCompleted ? "COMPLETADO" : "EN_PROGRESO", {
                timeLimitSeconds: null,
              }),
            ],
          }),
        ),
      ),
      http.post(`${API}/intentos/101/subtests/10/finalizar`, () => {
        if (failFinishSubtest) {
          return apiErr(500, "INTERNAL_ERROR", "Fallo temporal al cerrar subtest");
        }
        subtestCompleted = true;
        return ok({ id: 305, intentoId: 101, subtestId: 10, estado: "COMPLETADO" });
      }),
      http.post(`${API}/intentos/101/finalizar`, () => {
        if (failFinishAttempt) {
          return apiErr(500, "INTERNAL_ERROR", "Fallo temporal al cerrar intento");
        }
        return ok({ id: 101, asignacionId: 42, estado: "COMPLETADO" });
      }),
    );

    await renderRunnerAt("/evaluacion/subtests/10/items/2");
    expect(await screen.findByText("Pregunta 2 del subtest 10")).toBeInTheDocument();

    // Intento 1 de finalizar subtest -> 500 -> recupera respondiendo y permite seguir o reintentar
    fireEvent.click(screen.getByRole("button", { name: "Finalizar subtest" }));
    const subDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(subDialog).getByRole("button", { name: "Finalizar subtest" }));
    expect(await screen.findByText("Fallo temporal al cerrar subtest")).toBeInTheDocument();

    // Se puede cancelar para comprobar que los controles de respuesta volvieron a estar habilitados
    fireEvent.click(within(subDialog).getByRole("button", { name: "Seguir respondiendo" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("radio", { name: /Opción A2/i })).toBeEnabled();

    // Reintento 2 -> OK
    failFinishSubtest = false;
    fireEvent.click(screen.getByRole("button", { name: "Finalizar subtest" }));
    const subDialog2 = await screen.findByRole("alertdialog");
    fireEvent.click(within(subDialog2).getByRole("button", { name: "Finalizar subtest" }));
    expect(await screen.findByText("Resumen de su Evaluación")).toBeInTheDocument();

    // Intento 1 de finalizar evaluación -> 500 -> recupera resumen y permite reintentar
    fireEvent.click(screen.getByRole("button", { name: "Finalizar evaluación" }));
    const attDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(attDialog).getByRole("button", { name: "Confirmar entrega final" }));
    expect(await screen.findByText("Fallo temporal al cerrar intento")).toBeInTheDocument();

    failFinishAttempt = false;
    fireEvent.click(within(attDialog).getByRole("button", { name: "Confirmar entrega final" }));
    expect(await screen.findByText("Evaluación Finalizada")).toBeInTheDocument();
  });

  it("polling que marca el subtest activo como ANULADO redirige de /items/$ordinal a /evaluacion/sesion", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useParticipantAuth.getState().setSession({ token: "jwt-42", assignmentId: 42 });
    let annulled = false;

    server.use(
      http.get(`${API}/evaluacion-participante/yo`, () =>
        ok(
          makeEvaluationWire({
            subtests: [
              makeSubtestWire(10, 1, annulled ? "ANULADO" : "EN_PROGRESO", { timeLimitSeconds: null }),
              makeSubtestWire(20, 2, "NO_INICIADO", { timeLimitSeconds: null }),
            ],
          }),
        ),
      ),
    );

    const { router } = await renderRunnerAt("/evaluacion/subtests/10/items/1");
    expect(await screen.findByText("Pregunta 1 del subtest 10")).toBeInTheDocument();

    annulled = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/evaluacion/sesion"));
    expect(await screen.findByText("Subtests de la Evaluación")).toBeInTheDocument();
  });

  it("/evaluacion/acceso?code=42-invalido limpia ?code= de la URL al fallar mostrando el error", async () => {
    server.use(
      http.post(`${API}/acceso-participante/validar`, () =>
        apiErr(409, "TOKEN_EXPIRADO", "Expirado"),
      ),
    );

    const { router } = await renderRunnerAt("/evaluacion/acceso?code=42-invalido");
    expect(await screen.findByRole("alert")).toHaveTextContent(/expirado/i);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/evaluacion/acceso");
      expect(router.state.location.searchStr).toBe("");
    });
  });
});
