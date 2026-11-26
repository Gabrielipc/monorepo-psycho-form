import { beforeEach, describe, expect, it } from "vitest";
import { delay, http, HttpResponse } from "msw";
import { server } from "../test/msw/server";
import { ApiError } from "./errors";
import { participantService, STALE_PARTICIPANT } from "./participantService";
import { useEvaluationStore } from "../store/evaluationStore";
import { useParticipantAuth } from "../store/participantAuth";

const API = "http://localhost:8080";

const mockParticipant = (assignmentId: number, attemptId: number) =>
  server.use(
    http.post(`${API}/acceso-participante/validar`, () =>
      HttpResponse.json({ success: true, data: { assignmentId, participantId: `p${assignmentId}`, accessToken: `tok-${assignmentId}`, tokenType: "Bearer" } }),
    ),
    http.get(`${API}/evaluacion-participante/yo`, () =>
      HttpResponse.json({ success: true, data: { id: attemptId, assignmentId, subtests: [] } }),
    ),
  );

beforeEach(() => {
  useEvaluationStore.getState().clearStore();
  useParticipantAuth.getState().clear();
  sessionStorage.clear();
});

/** Promesa que se resuelve a mano: retiene una respuesta de MSW hasta `release()`. */
function gate(): { wait: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

type BulkItem = { itemId: number; status: "GUARDADA" | "RECHAZADA"; code: string | null; answerId: number | null };
const saved = (itemId: number): BulkItem => ({ itemId, status: "GUARDADA", code: null, answerId: itemId * 10 });
const rejected = (itemId: number, code: string): BulkItem => ({ itemId, status: "RECHAZADA", code, answerId: null });

/** Deja al participante `assignmentId` como dueño con intento `attemptId` y una cola con los ítems dados. */
function seedOwner(assignmentId: number, attemptId: number, itemIds: number[]) {
  const store = useEvaluationStore.getState();
  store.setOwner(assignmentId);
  store.setAttemptId(attemptId);
  store.setQueue(itemIds.map((itemId) => ({ itemId, selectedOptionIds: [itemId + 100], assignmentId, attemptId })));
}

describe("cola offline por participante", () => {
  it("la cola de A no se envía al intento de B", async () => {
    // A valida y deja una respuesta offline.
    mockParticipant(1, 100);
    await participantService.validateAccess("1-codigoA");
    useEvaluationStore.getState().setOffline(true);
    await participantService.saveAnswer("", "s", "11", "21");
    expect(useEvaluationStore.getState().syncQueue).toMatchObject([{ itemId: 11, assignmentId: 1, attemptId: 100 }]);

    // B valida en la misma pestaña.
    mockParticipant(2, 200);
    await participantService.validateAccess("2-codigoB");
    expect(useEvaluationStore.getState().syncQueue).toEqual([]);
    expect(useEvaluationStore.getState().ownerAssignmentId).toBe(2);
    expect(useEvaluationStore.getState().attemptId).toBe(200);

    const bulk: unknown[] = [];
    server.use(
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async ({ request, params }) => {
        bulk.push({ id: params.id, body: await request.json() });
        return HttpResponse.json({ success: true, data: [] });
      }),
    );
    await participantService.syncPendingAnswers("");
    expect(bulk).toEqual([]);
  });

  it("entradas ajenas que sobreviven (p. ej. residuo legacy) se descartan antes de enviar, sin tocar las propias", async () => {
    mockParticipant(2, 200);
    await participantService.validateAccess("2-codigoB");
    useEvaluationStore.setState({
      syncQueue: [
        { itemId: 11, selectedOptionIds: [21], assignmentId: 1, attemptId: 100 },
        { itemId: 12, selectedOptionIds: [22], timeUsedSeconds: 1, assignmentId: 2, attemptId: 200 },
        { itemId: 13, selectedOptionIds: [23], assignmentId: 2, attemptId: null },
      ],
    });

    const bulk: { id: unknown; body: unknown }[] = [];
    server.use(
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async ({ request, params }) => {
        bulk.push({ id: params.id, body: await request.json() });
        return HttpResponse.json({ success: true, data: [saved(12), saved(13)] });
      }),
    );
    await participantService.syncPendingAnswers("");

    expect(bulk).toHaveLength(1);
    expect(bulk[0].id).toBe("200");
    // Sin campos internos de propiedad en el payload; la entrada sin intento se adopta.
    expect(bulk[0].body).toEqual([
      { itemId: 12, selectedOptionIds: [22], timeUsedSeconds: 1 },
      { itemId: 13, selectedOptionIds: [23] },
    ]);
    expect(useEvaluationStore.getState().syncQueue).toEqual([]);
  });

  it("el mismo participante que vuelve a validar conserva su cola", async () => {
    mockParticipant(1, 100);
    await participantService.validateAccess("1-codigoA");
    useEvaluationStore.getState().setOffline(true);
    await participantService.saveAnswer("", "s", "11", "21");

    await participantService.validateAccess("1-codigoA");

    expect(useEvaluationStore.getState().syncQueue).toHaveLength(1);
  });

  it("evaluationStore persiste en sessionStorage, no en localStorage", () => {
    useEvaluationStore.getState().setOwner(5);
    expect(sessionStorage.getItem("bfa-digital-evaluation-storage")).toContain('"ownerAssignmentId":5');
    expect(localStorage.getItem("bfa-digital-evaluation-storage")).toBeNull();
  });
});

describe("bulk-sync: HTTP 200 no significa 'todo guardado'", () => {
  const bulkReturning = (data: unknown, onRequest?: (body: unknown) => void) =>
    server.use(
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async ({ request }) => {
        onRequest?.(await request.json());
        return HttpResponse.json({ success: true, data });
      }),
    );

  it("lote mixto: retira GUARDADA y rechazos definitivos (con motivo); conserva transitorios, desconocidos y sin confirmar", async () => {
    seedOwner(1, 100, [11, 12, 13, 14, 15, 16]);
    useEvaluationStore.getState().setOffline(true);
    bulkReturning([
      saved(11),
      rejected(12, "TIEMPO_AGOTADO"),
      rejected(13, "SUBTEST_FINALIZADO"),
      rejected(14, "SUBTEST_NO_INICIADO"),
      // 15: el backend no devolvió resultado para este ítem
      rejected(16, "CODIGO_NUEVO_DEL_BACKEND"),
    ]);

    await participantService.syncPendingAnswers("");

    const state = useEvaluationStore.getState();
    expect(state.syncQueue.map((a) => a.itemId)).toEqual([14, 15, 16]); // nada confirmado se pierde ni se reenvía
    expect(state.rejectedAnswers).toMatchObject([
      { itemId: 12, assignmentId: 1, attemptId: 100, code: "TIEMPO_AGOTADO" },
      { itemId: 13, assignmentId: 1, attemptId: 100, code: "SUBTEST_FINALIZADO" },
    ]);
    expect(state.rejectedAnswers.every((r) => r.reason.length > 0 && !Number.isNaN(Date.parse(r.rejectedAt)))).toBe(true);
    expect(state.isOffline).toBe(false); // el backend respondió
  });

  it("un lote 100% GUARDADA vacía la cola y no registra rechazos", async () => {
    seedOwner(1, 100, [11, 12]);
    bulkReturning([saved(11), saved(12)]);
    await participantService.syncPendingAnswers("");
    expect(useEvaluationStore.getState().syncQueue).toEqual([]);
    expect(useEvaluationStore.getState().rejectedAnswers).toEqual([]);
  });

  it("un cuerpo inesperado (no es una lista, o success:false) NO confirma nada: la cola se conserva", async () => {
    seedOwner(1, 100, [11, 12]);
    bulkReturning({ unexpected: true });
    await participantService.syncPendingAnswers("");
    expect(useEvaluationStore.getState().syncQueue).toHaveLength(2);

    server.use(
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, () => HttpResponse.json({ success: false, data: null })),
    );
    await participantService.syncPendingAnswers("");
    expect(useEvaluationStore.getState().syncQueue).toHaveLength(2);
    expect(useEvaluationStore.getState().rejectedAnswers).toEqual([]);
  });

  it("si la petición falla (5xx) la cola queda intacta y se marca offline", async () => {
    seedOwner(1, 100, [11]);
    server.use(http.post(`${API}/intentos/:id/respuestas/bulk-sync`, () => HttpResponse.json({ success: false }, { status: 503 })));
    await participantService.syncPendingAnswers("");
    expect(useEvaluationStore.getState().syncQueue).toHaveLength(1);
    expect(useEvaluationStore.getState().isOffline).toBe(true);
  });

  it("una respuesta nueva al mismo ítem durante el envío no se pierde aunque la anterior se confirme", async () => {
    seedOwner(1, 100, [11]);
    const hold = gate();
    server.use(
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async () => {
        await hold.wait;
        return HttpResponse.json({ success: true, data: [saved(11)] });
      }),
    );
    const pending = participantService.syncPendingAnswers("");
    await delay(10);
    useEvaluationStore.getState().addToQueue({ itemId: 11, selectedOptionIds: [999], assignmentId: 1, attemptId: 100 });
    hold.release();
    await pending;
    expect(useEvaluationStore.getState().syncQueue).toMatchObject([{ itemId: 11, selectedOptionIds: [999] }]);
  });
});

describe("bulk-sync serializado", () => {
  it("evento online + intervalo a la vez: nunca hay dos envíos en vuelo y no se reenvía lo ya guardado", async () => {
    seedOwner(1, 100, [11, 12]);
    const hold = gate();
    let active = 0;
    let maxActive = 0;
    const sent: number[][] = [];
    server.use(
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async ({ request }) => {
        const body = (await request.json()) as { itemId: number }[];
        sent.push(body.map((b) => b.itemId));
        active += 1;
        maxActive = Math.max(maxActive, active);
        await hold.wait;
        active -= 1;
        return HttpResponse.json({ success: true, data: body.map((b) => saved(b.itemId)) });
      }),
    );

    const online = participantService.syncPendingAnswers("");
    const interval = participantService.syncPendingAnswers("");
    await delay(30);
    expect(sent).toHaveLength(1); // el segundo espera al primero
    hold.release();
    await Promise.all([online, interval]);

    expect(maxActive).toBe(1);
    expect(sent).toEqual([[11, 12]]); // el segundo envío ve la cola ya vacía
    expect(useEvaluationStore.getState().syncQueue).toEqual([]);
  });

  it("lo encolado durante un envío se manda en el siguiente, siempre de uno en uno", async () => {
    seedOwner(1, 100, [11]);
    const hold = gate();
    let active = 0;
    let maxActive = 0;
    const sent: number[][] = [];
    server.use(
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async ({ request }) => {
        const body = (await request.json()) as { itemId: number }[];
        sent.push(body.map((b) => b.itemId));
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (sent.length === 1) await hold.wait;
        active -= 1;
        return HttpResponse.json({ success: true, data: body.map((b) => saved(b.itemId)) });
      }),
    );

    const first = participantService.syncPendingAnswers("");
    await delay(20);
    useEvaluationStore.getState().addToQueue({ itemId: 22, selectedOptionIds: [122], assignmentId: 1, attemptId: 100 });
    const second = participantService.syncPendingAnswers("");
    const third = participantService.syncPendingAnswers(""); // comparte el pendiente con `second`
    hold.release();
    await Promise.all([first, second, third]);

    expect(sent).toEqual([[11], [22]]);
    expect(maxActive).toBe(1);
    expect(useEvaluationStore.getState().syncQueue).toEqual([]);
  });
});

describe("respuestas tardías del runner (STALE_PARTICIPANT)", () => {
  /** Handlers dependientes del participante; el /yo de `slowAssignment` queda retenido. */
  const mockMany = (slow?: { assignmentId: number; wait: Promise<void> }) =>
    server.use(
      http.post(`${API}/acceso-participante/validar`, async ({ request }) => {
        const { assignmentId } = (await request.json()) as { assignmentId: number };
        return HttpResponse.json({
          success: true,
          data: { assignmentId, participantId: `p${assignmentId}`, accessToken: `tok-${assignmentId}`, tokenType: "Bearer" },
        });
      }),
      http.get(`${API}/evaluacion-participante/yo`, async ({ request }) => {
        const assignmentId = Number((request.headers.get("authorization") ?? "").replace("Bearer tok-", ""));
        if (slow && slow.assignmentId === assignmentId) await slow.wait;
        return HttpResponse.json({ success: true, data: { id: assignmentId * 100, assignmentId, subtests: [] } });
      }),
    );

  const staleCode = async (promise: Promise<unknown>): Promise<unknown> =>
    ((await promise.catch((e: unknown) => e)) as ApiError).code;

  it("validateAccess tardío de A no deja el attemptId (ni la sesión) de A en B", async () => {
    const hold = gate();
    mockMany({ assignmentId: 1, wait: hold.wait });

    const lateA = participantService.validateAccess("1-codigoA");
    await delay(20); // A ya validó el código y espera /yo
    await participantService.validateAccess("2-codigoB");
    expect(useEvaluationStore.getState().attemptId).toBe(200);

    hold.release();
    expect(await staleCode(lateA)).toBe(STALE_PARTICIPANT);

    const state = useEvaluationStore.getState();
    expect(state.ownerAssignmentId).toBe(2);
    expect(state.attemptId).toBe(200);
    expect(state.ownerAttemptId).toBe(200);
    expect(useParticipantAuth.getState().assignmentId).toBe(2);
    expect(useParticipantAuth.getState().token).toBe("tok-2");
  });

  it("validateAccess duplicado de la MISMA asignación (efecto doble) no se descarta", async () => {
    mockMany();
    const [a, b] = await Promise.all([participantService.validateAccess("1-codigoA"), participantService.validateAccess("1-codigoA")]);
    expect(a.assignmentId).toBe("1");
    expect(b.assignmentId).toBe("1");
    expect(useEvaluationStore.getState().attemptId).toBe(100);
  });

  it("el inicio de intento tardío de A (getOrCreateAttemptId) no deja el attemptId de A en B", async () => {
    const hold = gate();
    mockMany();
    server.use(
      http.post(`${API}/evaluacion-participante/iniciar`, async () => {
        await hold.wait;
        return HttpResponse.json({ success: true, data: { id: 777 } });
      }),
    );
    // A es el dueño, con acceso validado pero sin intento todavía.
    const store = useEvaluationStore.getState();
    store.setOwner(1);
    store.setAccessData({ assignmentId: "1", subtests: [] } as never);

    const lateA = participantService.getOrCreateAttemptId();
    await delay(10);
    await participantService.validateAccess("2-codigoB"); // B pasa a ser el dueño (intento 200)

    hold.release();
    expect(await staleCode(lateA)).toBe(STALE_PARTICIPANT);

    expect(useEvaluationStore.getState().ownerAssignmentId).toBe(2);
    expect(useEvaluationStore.getState().attemptId).toBe(200);
    expect(useEvaluationStore.getState().ownerAttemptId).toBe(200);
  });

  it("startSubtest / getItem / finishSubtest / finishEvaluation / startAttempt tardíos rechazan con STALE_PARTICIPANT", async () => {
    const holds = { start: gate(), items: gate(), finishSub: gate(), finish: gate(), attempt: gate() };
    mockMany();
    server.use(
      http.post(`${API}/intentos/:id/subtests/:sid/iniciar`, async () => {
        await holds.start.wait;
        return HttpResponse.json({ success: true, data: null });
      }),
      http.get(`${API}/intentos/:id/subtests/:sid/items`, async () => {
        await holds.items.wait;
        return HttpResponse.json({ success: true, data: [] });
      }),
      http.post(`${API}/intentos/:id/subtests/:sid/finalizar`, async () => {
        await holds.finishSub.wait;
        return HttpResponse.json({ success: true, data: null });
      }),
      http.post(`${API}/intentos/:id/finalizar`, async () => {
        await holds.finish.wait;
        return HttpResponse.json({ success: true, data: null });
      }),
      http.post(`${API}/evaluacion-participante/iniciar`, async () => {
        await holds.attempt.wait;
        return HttpResponse.json({ success: true, data: { id: 555 } });
      }),
    );

    await participantService.validateAccess("1-codigoA");
    useEvaluationStore.getState().setAccessData({
      assignmentId: "1",
      subtests: [{ id: "5", slug: "figuras", name: "Figuras" }],
    } as never);

    const calls = [
      participantService.startSubtest("", "figuras"),
      participantService.getItem("", "figuras", "it-1"),
      participantService.finishSubtest("", "figuras"),
      participantService.finishEvaluation(""),
      participantService.startAttempt(1),
    ].map((promise) => promise.catch((e: unknown) => e));
    await delay(30);

    await participantService.validateAccess("2-codigoB"); // otro participante mientras vuelan
    Object.values(holds).forEach((h) => h.release());

    const outcomes = (await Promise.all(calls)) as ApiError[];
    expect(outcomes.map((o) => o.code)).toEqual(Array(5).fill(STALE_PARTICIPANT));
    expect(useEvaluationStore.getState().attemptId).toBe(200);
  });

  it("una respuesta tardía de A (saveAnswer) no se encola en B", async () => {
    const hold = gate();
    mockMany();
    server.use(
      http.put(`${API}/intentos/:id/items/:itemId/respuesta`, async () => {
        await hold.wait;
        return HttpResponse.json({ success: true, data: null });
      }),
    );
    await participantService.validateAccess("1-codigoA");
    const late = participantService.saveAnswer("", "s", "11", "21");
    await delay(20);
    await participantService.validateAccess("2-codigoB");
    hold.release();
    await late;
    expect(useEvaluationStore.getState().syncQueue).toEqual([]);
  });

  it("un bulk-sync tardío de A no toca la cola ni los rechazos de B", async () => {
    const hold = gate();
    mockMany();
    await participantService.validateAccess("1-codigoA");
    useEvaluationStore.getState().setQueue([{ itemId: 11, selectedOptionIds: [21], assignmentId: 1, attemptId: 100 }]);
    server.use(
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async () => {
        await hold.wait;
        return HttpResponse.json({ success: true, data: [rejected(11, "TIEMPO_AGOTADO")] });
      }),
    );

    const lateSync = participantService.syncPendingAnswers("");
    await delay(20);
    await participantService.validateAccess("2-codigoB");
    useEvaluationStore.getState().addToQueue({ itemId: 11, selectedOptionIds: [31], assignmentId: 2, attemptId: 200 });
    hold.release();
    await lateSync;

    const state = useEvaluationStore.getState();
    expect(state.rejectedAnswers).toEqual([]);
    expect(state.syncQueue).toMatchObject([{ itemId: 11, assignmentId: 2, selectedOptionIds: [31] }]);
  });
});

describe("clasificación de rechazos de bulk-sync (códigos reales del backend)", () => {
  it.each(["SUBTEST_FINALIZADO", "TIEMPO_AGOTADO", "ITEM_NO_ENCONTRADO", "OPCION_INVALIDA", "RESPUESTA_INVALIDA"])(
    "%s es definitivo: sale de la cola y pasa a rejectedAnswers",
    async (code) => {
      seedOwner(1, 100, [11]);
      server.use(
        http.post(`${API}/intentos/:id/respuestas/bulk-sync`, () =>
          HttpResponse.json({ success: true, data: [rejected(11, code)] }),
        ),
      );
      await participantService.syncPendingAnswers("");
      expect(useEvaluationStore.getState().syncQueue).toEqual([]);
      expect(useEvaluationStore.getState().rejectedAnswers).toMatchObject([{ itemId: 11, code }]);
    },
  );

  it("SUBTEST_NO_INICIADO y los códigos desconocidos son transitorios: se conservan en la cola", async () => {
    seedOwner(1, 100, [11, 12]);
    server.use(
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, () =>
        HttpResponse.json({ success: true, data: [rejected(11, "SUBTEST_NO_INICIADO"), rejected(12, "OTRO")] }),
      ),
    );
    await participantService.syncPendingAnswers("");
    expect(useEvaluationStore.getState().syncQueue.map((a) => a.itemId)).toEqual([11, 12]);
    expect(useEvaluationStore.getState().rejectedAnswers).toEqual([]);
  });
});

describe("orden por ítem: una versión nueva nunca se adelanta ni es pisada por una vieja", () => {
  type Put = { itemId: string; body: unknown };

  it("lote conserva 21 por SUBTEST_NO_INICIADO → nueva selección 99: sin PUT directo, el lote siguiente envía 99 (nunca 21 después de 99)", async () => {
    seedOwner(1, 100, [11]);
    useEvaluationStore.getState().setQueue([{ itemId: 11, selectedOptionIds: [21], assignmentId: 1, attemptId: 100 }]);
    const batches: number[][] = [];
    const puts: Put[] = [];
    let call = 0;
    server.use(
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async ({ request }) => {
        const body = (await request.json()) as { itemId: number; selectedOptionIds: number[] }[];
        batches.push(body.flatMap((b) => b.selectedOptionIds));
        call += 1;
        return HttpResponse.json({ success: true, data: call === 1 ? [rejected(11, "SUBTEST_NO_INICIADO")] : body.map((b) => saved(b.itemId)) });
      }),
      http.put(`${API}/intentos/:id/items/:itemId/respuesta`, async ({ request, params }) => {
        puts.push({ itemId: String(params.itemId), body: await request.json() });
        return HttpResponse.json({ success: true, data: null });
      }),
    );

    await participantService.syncPendingAnswers(""); // lote 1: 21 se conserva
    expect(useEvaluationStore.getState().syncQueue).toMatchObject([{ itemId: 11, selectedOptionIds: [21] }]);

    await participantService.saveAnswer("", "s", "11", "99");

    expect(puts).toEqual([]); // sin PUT directo
    expect(batches).toEqual([[21], [99]]); // 21 nunca se envía después de 99
    expect(useEvaluationStore.getState().syncQueue).toEqual([]);
  });

  it("con el ítem en un lote en vuelo, la versión nueva reemplaza en la cola y no se borra al confirmarse la vieja", async () => {
    seedOwner(1, 100, [11]);
    const hold = gate();
    const batches: number[][] = [];
    const puts: Put[] = [];
    server.use(
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async ({ request }) => {
        const body = (await request.json()) as { itemId: number; selectedOptionIds: number[] }[];
        batches.push(body.flatMap((b) => b.selectedOptionIds));
        if (batches.length === 1) await hold.wait;
        return HttpResponse.json({ success: true, data: body.map((b) => saved(b.itemId)) });
      }),
      http.put(`${API}/intentos/:id/items/:itemId/respuesta`, async ({ request, params }) => {
        puts.push({ itemId: String(params.itemId), body: await request.json() });
        return HttpResponse.json({ success: true, data: null });
      }),
    );

    const first = participantService.syncPendingAnswers("");
    await delay(20);
    const second = participantService.saveAnswer("", "s", "11", "99"); // el ítem 11 (opción 111) está en vuelo
    await delay(10);
    expect(useEvaluationStore.getState().syncQueue).toMatchObject([{ itemId: 11, selectedOptionIds: [99] }]);
    hold.release();
    await Promise.all([first, second]);

    expect(puts).toEqual([]);
    expect(batches).toEqual([[111], [99]]);
    expect(useEvaluationStore.getState().syncQueue).toEqual([]);
  });

  it("removeFromQueue retira la misma versión aunque sea otra referencia (attemptId adoptado) y conserva una versión distinta", () => {
    const store = useEvaluationStore.getState();
    const sent = { itemId: 11, selectedOptionIds: [21], assignmentId: 1, attemptId: null };
    store.setQueue([
      { ...sent, attemptId: 100 }, // misma versión, copia con attemptId adoptado
      { itemId: 12, selectedOptionIds: [99], assignmentId: 1, attemptId: 100 }, // otra versión del ítem 12
    ]);
    store.removeFromQueue([sent, { itemId: 12, selectedOptionIds: [22], assignmentId: 1, attemptId: 100 }]);
    expect(useEvaluationStore.getState().syncQueue).toMatchObject([{ itemId: 12, selectedOptionIds: [99] }]);
  });

  it("un PUT directo en vuelo que luego falla por red no pisa una versión más nueva encolada", async () => {
    mockParticipant(1, 100);
    await participantService.validateAccess("1-codigoA");
    const hold = gate();
    const batches: number[][] = [];
    server.use(
      http.put(`${API}/intentos/:id/items/:itemId/respuesta`, async () => {
        await hold.wait;
        return HttpResponse.error(); // error de red tras retenerse
      }),
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async ({ request }) => {
        const body = (await request.json()) as { itemId: number; selectedOptionIds: number[] }[];
        batches.push(body.flatMap((b) => b.selectedOptionIds));
        return HttpResponse.json({ success: true, data: body.map((b) => saved(b.itemId)) });
      }),
    );

    const first = participantService.saveAnswer("", "s", "11", "21"); // PUT directo, retenido
    await delay(20);
    const second = participantService.saveAnswer("", "s", "11", "99"); // misma pregunta: va por la cola
    await delay(10);
    hold.release();
    await Promise.all([first, second]);

    expect(batches).toEqual([[99]]); // 21 jamás se encola/envía después de 99
    expect(useEvaluationStore.getState().syncQueue).toEqual([]);
  });
});

describe("flush concurrente con un PUT en vuelo", () => {
  it("un flush (online/temporizador) mientras el PUT del ítem sigue pendiente no lo envía; al terminar se reintenta y prevalece la selección más reciente", async () => {
    mockParticipant(1, 100);
    await participantService.validateAccess("1-codigoA");
    const hold = gate();
    const events: string[] = [];
    server.use(
      http.put(`${API}/intentos/:id/items/:itemId/respuesta`, async ({ request }) => {
        const body = (await request.json()) as { selectedOptionIds: number[] };
        events.push(`put-start:${body.selectedOptionIds[0]}`);
        await hold.wait;
        events.push(`put-end:${body.selectedOptionIds[0]}`);
        return HttpResponse.json({ success: true, data: null });
      }),
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async ({ request }) => {
        const body = (await request.json()) as { itemId: number; selectedOptionIds: number[] }[];
        events.push(`post:${body.flatMap((b) => b.selectedOptionIds).join(",")}`);
        return HttpResponse.json({ success: true, data: body.map((b) => saved(b.itemId)) });
      }),
    );

    const first = participantService.saveAnswer("", "s", "11", "21"); // PUT directo, retenido
    await delay(20);
    // Versión nueva del mismo ítem: va a la cola y espera al PUT.
    const second = participantService.saveAnswer("", "s", "11", "99");
    await delay(10);
    // Evento `online` / temporizador mientras el PUT sigue en vuelo.
    const flush = participantService.syncPendingAnswers("");
    await delay(40);
    expect(events).toEqual(["put-start:21"]); // ningún POST se adelantó al PUT
    expect(useEvaluationStore.getState().syncQueue).toMatchObject([{ itemId: 11, selectedOptionIds: [99] }]);

    hold.release();
    await Promise.all([first, second, flush]);
    await delay(20);

    expect(events).toEqual(["put-start:21", "put-end:21", "post:99"]); // el POST (99) va DESPUÉS del PUT (21)
    expect(useEvaluationStore.getState().syncQueue).toEqual([]);
  });
});

describe("flush concurrente con un PUT en vuelo: reintento disparado solo por online/temporizador", () => {
  it("sin un segundo saveAnswer: la entrada ya encolada espera al PUT y el flush la reintenta al terminar (sin quedarse varada)", async () => {
    mockParticipant(1, 100);
    await participantService.validateAccess("1-codigoA");
    const hold = gate();
    const events: string[] = [];
    server.use(
      http.put(`${API}/intentos/:id/items/:itemId/respuesta`, async ({ request }) => {
        const body = (await request.json()) as { selectedOptionIds: number[] };
        events.push(`put-start:${body.selectedOptionIds[0]}`);
        await hold.wait;
        events.push(`put-end:${body.selectedOptionIds[0]}`);
        return HttpResponse.json({ success: true, data: null });
      }),
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async ({ request }) => {
        const body = (await request.json()) as { itemId: number; selectedOptionIds: number[] }[];
        events.push(`post:${body.flatMap((b) => b.selectedOptionIds).join(",")}`);
        return HttpResponse.json({ success: true, data: body.map((b) => saved(b.itemId)) });
      }),
    );

    // Único saveAnswer: PUT directo retenido.
    const first = participantService.saveAnswer("", "s", "11", "21");
    await delay(20);
    // La cola ya trae una versión del mismo ítem (p. ej. residuo de una caída previa), sin segundo saveAnswer.
    useEvaluationStore.getState().addToQueue({ itemId: 11, selectedOptionIds: [99], assignmentId: 1, attemptId: 100 });

    // Solo el evento `online` / el temporizador dispara el flush mientras el PUT sigue en vuelo.
    const flush = participantService.syncPendingAnswers("");
    await delay(40);
    expect(events).toEqual(["put-start:21"]); // ningún POST se adelantó al PUT
    expect(useEvaluationStore.getState().syncQueue).toMatchObject([{ itemId: 11, selectedOptionIds: [99] }]);

    hold.release();
    await Promise.all([first, flush]);
    await delay(40);

    expect(events).toEqual(["put-start:21", "put-end:21", "post:99"]); // el reintento ocurre solo, DESPUÉS del PUT
    expect(useEvaluationStore.getState().syncQueue).toEqual([]);
  });
});

describe("isOffline frente a respuestas tardías de otro participante", () => {
  const switchToB = () => {
    const store = useEvaluationStore.getState();
    store.clearStore();
    store.setOwner(2);
    store.setAttemptId(200);
  };

  it("un PUT tardío exitoso de A no pone isOffline=false en B", async () => {
    mockParticipant(1, 100);
    await participantService.validateAccess("1-codigoA");
    const hold = gate();
    server.use(
      http.put(`${API}/intentos/:id/items/:itemId/respuesta`, async () => {
        await hold.wait;
        return HttpResponse.json({ success: true, data: null });
      }),
    );

    const late = participantService.saveAnswer("", "s", "11", "21");
    await delay(20);
    switchToB();
    useEvaluationStore.getState().setOffline(true); // B está offline
    hold.release();
    await late;

    expect(useEvaluationStore.getState().isOffline).toBe(true);
    expect(useEvaluationStore.getState().syncQueue).toEqual([]);
  });

  it("un PUT tardío con fallo de red de A no pone isOffline=true en B", async () => {
    mockParticipant(1, 100);
    await participantService.validateAccess("1-codigoA");
    const hold = gate();
    server.use(
      http.put(`${API}/intentos/:id/items/:itemId/respuesta`, async () => {
        await hold.wait;
        return HttpResponse.error();
      }),
    );

    const late = participantService.saveAnswer("", "s", "11", "21");
    await delay(20);
    switchToB();
    hold.release();
    await late;

    expect(useEvaluationStore.getState().isOffline).toBe(false);
    expect(useEvaluationStore.getState().syncQueue).toEqual([]);
  });

  it("un bulk-sync tardío de A que termina en 503 no marca offline a B ni toca su cola", async () => {
    seedOwner(1, 100, [11]);
    const hold = gate();
    server.use(
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async () => {
        await hold.wait;
        return HttpResponse.json({ success: false }, { status: 503 });
      }),
    );

    const late = participantService.syncPendingAnswers("");
    await delay(20);
    switchToB();
    useEvaluationStore.getState().addToQueue({ itemId: 11, selectedOptionIds: [31], assignmentId: 2, attemptId: 200 });
    hold.release();
    await late;

    expect(useEvaluationStore.getState().isOffline).toBe(false);
    expect(useEvaluationStore.getState().syncQueue).toMatchObject([{ assignmentId: 2, selectedOptionIds: [31] }]);
  });

  it("un bulk-sync tardío de A que responde 200 no pone isOffline=false en B", async () => {
    seedOwner(1, 100, [11]);
    const hold = gate();
    server.use(
      http.post(`${API}/intentos/:id/respuestas/bulk-sync`, async () => {
        await hold.wait;
        return HttpResponse.json({ success: true, data: [saved(11)] });
      }),
    );

    const late = participantService.syncPendingAnswers("");
    await delay(20);
    switchToB();
    useEvaluationStore.getState().setOffline(true);
    hold.release();
    await late;

    expect(useEvaluationStore.getState().isOffline).toBe(true);
  });
});
