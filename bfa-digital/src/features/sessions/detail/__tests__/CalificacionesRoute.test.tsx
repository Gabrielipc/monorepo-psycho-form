import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { render, screen, waitFor } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { Route as CalificacionesRoute } from "../../../../routes/app/calificaciones";
import { gradingSearchSchema } from "../gradingSearch";
import { useAdminStore } from "../../../../store/adminStore";
import { server } from "../../../../test/msw/server";
import { API, ok } from "./testUtils";

const sessionWire = (id: number) => ({
  id,
  codigoSesion: `SES-${id}`,
  nombreSesion: `Sesión ${id}`,
  inicioProgramado: "2026-11-24T09:00:00",
  ubicacion: null,
  estado: "PROGRAMADA",
});

const cachedSession = (id: string) => ({
  id,
  code: `SES-${id}`,
  name: `Sesión ${id}`,
  group: "BFA - General",
  date: "",
  time: "",
  location: "Virtual",
  applicator: "Aplicador",
  status: "PLANIFICADA" as const,
  subtests: [],
});

async function renderRoute(search: string) {
  const rootRoute = createRootRoute();
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "/app/calificaciones",
    validateSearch: gradingSearchSchema,
    component: CalificacionesRoute.options.component as never,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [`/app/calificaciones${search}`] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

describe("/app/calificaciones — preselección con la lista fresca", () => {
  let assignmentRequests: string[] = [];

  beforeEach(() => {
    assignmentRequests = [];
    useAdminStore.setState({ sessions: [], assignments: {}, error: null, loading: false });
    server.use(
      http.get(`${API}/sesiones/:id/asignaciones`, ({ params }) => {
        assignmentRequests.push(String(params.id));
        return HttpResponse.json({ success: false, data: null, message: "boom" }, { status: 500 });
      }),
    );
  });
  afterEach(() => useAdminStore.setState({ sessions: [], assignments: {}, error: null, loading: false }));

  it("?sessionId=9 con lista fresca [1]: avisa, selecciona la primera y un fallo de asignaciones no impide la resolución", async () => {
    // Caché obsoleta que sí contiene la 9: no debe usarse ni pedirse sus asignaciones.
    useAdminStore.setState({ sessions: [cachedSession("9")] });
    server.use(http.get(`${API}/sesiones`, () => ok([sessionWire(1)])));

    await renderRoute("?sessionId=9");

    expect(await screen.findByText(/La sesión #9 solicitada no está en la lista de sesiones actual/)).toBeInTheDocument();
    await waitFor(() => expect(assignmentRequests).toContain("1"));
    expect(assignmentRequests).not.toContain("9");
  });

  it("lista fresca vacía: limpia la selección, deshabilita «Actualizar» y muestra el aviso", async () => {
    useAdminStore.setState({ sessions: [cachedSession("1")] });
    server.use(http.get(`${API}/sesiones`, () => ok([])));

    await renderRoute("");

    expect(await screen.findByText(/No hay sesiones disponibles/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /actualizar/i })).toBeDisabled();
  });
});
