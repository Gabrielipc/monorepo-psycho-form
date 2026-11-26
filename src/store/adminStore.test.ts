import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw/server";
import { ADMIN_STORAGE_KEY, useAdminStore } from "./adminStore";
import { useStaffAuth } from "./staffAuth";
import { delay } from "msw";

const API = "http://localhost:8080";

afterEach(() => {
  useAdminStore.setState({ generatedTokens: {} });
  localStorage.clear();
});

describe("adminStore: los tokens de acceso no se persisten", () => {
  it("tras asignar con el flujo legacy, el token queda en memoria pero localStorage no lo contiene", async () => {
    server.use(
      http.post(`${API}/sesiones`, () => HttpResponse.json({ success: true, data: { id: 5 } })),
      http.put(`${API}/sesiones/5/subtests`, () => HttpResponse.json({ success: true, data: null })),
      http.post(`${API}/sesiones/5/asignaciones`, () =>
        HttpResponse.json({ success: true, data: { assignmentId: 9, rawToken: "TOKEN-SECRETO-XYZ" } }),
      ),
      http.get(`${API}/sesiones`, () => HttpResponse.json({ success: true, data: [] })),
      http.get(`${API}/sesiones/5/asignaciones`, () => HttpResponse.json({ success: true, data: [] })),
    );

    await useAdminStore.getState().createSession(
      { nombreSesion: "S" } as never,
      [] as never,
      ["p1"] as never,
    );

    expect(useAdminStore.getState().generatedTokens["9"]).toBe("9-TOKEN-SECRETO-XYZ");
    const stored = localStorage.getItem(ADMIN_STORAGE_KEY) ?? "";
    expect(stored).not.toContain("TOKEN-SECRETO-XYZ");
    expect(stored).not.toContain("generatedTokens");
  });

  it("la migración elimina los generatedTokens persistidos por versiones anteriores", async () => {
    localStorage.setItem(
      ADMIN_STORAGE_KEY,
      JSON.stringify({ state: { generatedTokens: { "9": "9-TOKEN-VIEJO" } }, version: 0 }),
    );

    await useAdminStore.persist.rehydrate();

    expect(useAdminStore.getState().generatedTokens).toEqual({});
    expect(localStorage.getItem(ADMIN_STORAGE_KEY) ?? "").not.toContain("TOKEN-VIEJO");
    vi.restoreAllMocks();
  });
});

describe("adminStore: respuestas tardías tras cambiar de cuenta", () => {
  afterEach(() => {
    useStaffAuth.getState().clear();
    useAdminStore.setState({ sessions: [], assignments: {}, error: null });
  });

  it("fetchSessions no publica la lista si la cuenta cambió durante la petición", async () => {
    server.use(
      http.get(`${API}/sesiones`, async () => {
        await delay(20);
        return HttpResponse.json({ success: true, data: [{ id: 1, codigoSesion: "A", estado: "ABIERTA" }] });
      }),
    );
    const pending = useAdminStore.getState().fetchSessions();
    useStaffAuth.getState().setSession({ token: "otra", expiresAt: null });
    await pending;
    expect(useAdminStore.getState().sessions).toEqual([]);
  });

  it("fetchAssignments no publica asignaciones ni error si la cuenta cambió", async () => {
    server.use(
      http.get(`${API}/sesiones/7/asignaciones`, async () => {
        await delay(20);
        return HttpResponse.json({ success: false, message: "x" }, { status: 500 });
      }),
    );
    const pending = useAdminStore.getState().fetchAssignments("7");
    useStaffAuth.getState().setSession({ token: "otra", expiresAt: null });
    await pending;
    expect(useAdminStore.getState().error).toBeNull();
    expect(useAdminStore.getState().assignments["7"]).toBeUndefined();
  });
});
