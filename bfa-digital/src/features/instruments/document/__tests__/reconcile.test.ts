import { describe, expect, it } from "vitest";
import { createDocumentReducer } from "../reducer";
import { reconcileVersionDocumentThreeWay } from "../reconcile";
import {
  baremoNaturalKey,
  canonicalBaremo,
  canonicalItem,
  canonicalOption,
  canonicalSubtest,
  createEmptySentSnapshot,
  itemNaturalKey,
  optionNaturalKey,
  sentKey,
  subtestNaturalKey,
  uploadSlotKey,
} from "../sent";
import type { DocumentBaremo, DocumentImage } from "../types";
import { createCleanDocument, makeDeterministicDraftIdFactory } from "./fixtures";

describe("reconcileVersionDocumentThreeWay (F3-FIX-5)", () => {
  it("Hallazgo 1 (ALTO): borrar un subtest localmente mientras el servidor edita un ítem hijo produce 409 listando los descendientes", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(100));

    const mine = reducer(base, {
      type: "DELETE_SUBTEST",
      subtestDraftId: "sub-20",
    });

    const theirs = reducer(base, {
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { prompt: "Enunciado editado por otro usuario" },
    });

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs });

    expect(result.conflicts.length).toBeGreaterThanOrEqual(2);
    expect(result.conflicts.some((c) => c.kind === "subtest" && c.label.includes("MEM"))).toBe(true);
    expect(result.conflicts.some((c) => c.kind === "item" && c.label.includes("IT-1"))).toBe(true);
  });

  it("Decision 4 (inversa): editar un ítem hijo localmente mientras el servidor borró el subtest padre produce 409 listando el cambio local", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(110));

    const mine = reducer(base, {
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      patch: { prompt: "Edición local en hijo" },
    });

    const theirs = structuredClone(base);
    theirs.subtests = [];

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs });

    expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(result.conflicts.some((c) => c.kind === "subtest")).toBe(true);
    expect(
      result.conflicts.some((c) => c.reason.includes("IT-1") && c.reason.includes("eliminó")),
    ).toBe(true);
  });

  it("Hallazgo 2 (MEDIO): imagen pendiente con error incierto se adopta si aparece en el mismo slot en theirs", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(120));

    const mine = reducer(base, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-local-2",
        pendingFileId: "file-2",
        order: 2,
        altText: "Estímulo 2",
        role: "ENUNCIADO",
        fileName: "dos.png",
      },
    });

    const theirs = structuredClone(base);
    const persistedImg: DocumentImage = {
      id: 777,
      draftId: "img-777",
      sourceId: null,
      resourceId: 901,
      pendingFileId: null,
      previewUrl: "/items/images/resources/901",
      status: "EXISTING",
      order: 2,
      altText: "Estímulo 2",
      role: "ENUNCIADO",
      fileName: "dos.png",
    };
    theirs.subtests[0]!.items[0]!.images.push(persistedImg);

    const sent = createEmptySentSnapshot();
    const slotKey = uploadSlotKey({
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 2,
    });
    sent.uploads[slotKey] = {
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 2,
      altText: "Estímulo 2",
      role: "ENUNCIADO",
    };

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs, sent });
    expect(result.conflicts).toEqual([]);
    const reconciledImg = result.document.subtests[0]!.items[0]!.images.find(
      (img) => img.order === 2,
    );
    expect(reconciledImg).toMatchObject({
      id: 777,
      resourceId: 901,
      pendingFileId: null,
      status: "EXISTING",
    });
    expect(result.sent.uploads[slotKey]).toBeUndefined();
  });

  it("Hallazgo 3 (MEDIO): editar baremo tras guardado parcial cuyo primer envío sí aplicó deja la diferencia como UPDATED sin 409", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(130));

    let mine = reducer(base, {
      type: "ADD_BAREMO",
      input: { draftId: "bar-new", code: "BAR-TOT", name: "Nombre enviado", dimensionId: null },
    });

    const sent = createEmptySentSnapshot();
    sent.nodes[sentKey.baremo("bar-new")] = {
      op: "CREATED",
      sig: canonicalBaremo(mine.baremos[0]!),
    };

    // Usuario edita el nombre antes de reintentar
    mine = reducer(mine, {
      type: "UPDATE_BAREMO",
      baremoDraftId: "bar-new",
      patch: { name: "Nombre editado después" },
    });

    // El servidor sí había persistido "Nombre enviado" con id 95
    const theirs = structuredClone(base);
    theirs.baremos.push({
      id: 95,
      draftId: "baremo-95",
      status: "EXISTING",
      dimensionId: null,
      code: "BAR-TOT",
      name: "Nombre enviado",
      description: "",
      normativeGroup: "General",
      ranges: [],
    });

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs, sent });
    expect(result.conflicts).toEqual([]);
    expect(result.document.baremos[0]).toMatchObject({
      id: 95,
      status: "UPDATED",
      code: "BAR-TOT",
      name: "Nombre editado después",
    });
    expect(result.sent.nodes[sentKey.baremo("bar-new")]).toBeUndefined();
  });

  it("Hallazgo 4 (MEDIO): cambiar solo mayúsculas (BAR-GEN → bar-gen) se conserva como cambio pendiente real", () => {
    const base = createCleanDocument();
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(140));
    const mine = reducer(base, {
      type: "UPDATE_BAREMO",
      baremoDraftId: "bar-90",
      patch: { code: "bar-gen" },
    });
    const theirs = structuredClone(base);

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs });
    expect(result.conflicts).toEqual([]);
    expect(result.document.baremos[0]?.code).toBe("bar-gen");
    expect(result.document.baremos[0]?.status).toBe("UPDATED");
  });

  it("Baremos con el mismo code en dos dimensiones y candidatos en orden invertido: sin conflictos", () => {
    const base = createCleanDocument({ baremos: [] });
    const makeDimBaremo = (
      id: number | null,
      draftId: string,
      dimensionId: number,
      name: string,
    ): DocumentBaremo => ({
      id,
      draftId,
      status: id === null ? "CREATED" : "EXISTING",
      dimensionId,
      code: "BAR-DIM",
      name,
      description: "",
      normativeGroup: "General",
      ranges: [],
    });

    const mine = {
      ...base,
      baremos: [
        makeDimBaremo(null, "bar-d1", 1, "Dimensión 1"),
        makeDimBaremo(null, "bar-d2", 2, "Dimensión 2"),
      ],
    };

    // Orden invertido en theirs
    const theirs = {
      ...base,
      baremos: [
        makeDimBaremo(92, "baremo-92", 2, "Dimensión 2"),
        makeDimBaremo(91, "baremo-91", 1, "Dimensión 1"),
      ],
    };

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs });
    expect(result.conflicts).toEqual([]);
    expect(result.document.baremos).toHaveLength(2);
    expect(result.document.baremos.find((b) => b.dimensionId === 1)?.id).toBe(91);
    expect(result.document.baremos.find((b) => b.dimensionId === 2)?.id).toBe(92);
    expect(result.document.baremos.every((b) => b.status === "EXISTING")).toBe(true);
  });

  it("Clave ambigua (code vacío o duplicado): conflicto manual y nunca adopta id", () => {
    const base = createCleanDocument({ baremos: [] });

    // 1. Code vacío
    const mineEmpty = {
      ...base,
      baremos: [
        {
          id: null,
          draftId: "bar-empty",
          status: "CREATED" as const,
          dimensionId: null,
          code: "   ",
          name: "Sin código",
          description: "",
          normativeGroup: "",
          ranges: [],
        },
      ],
    };
    const theirsOne = {
      ...base,
      baremos: [
        {
          id: 99,
          draftId: "baremo-99",
          status: "EXISTING" as const,
          dimensionId: null,
          code: "BAR-99",
          name: "Otro",
          description: "",
          normativeGroup: "",
          ranges: [],
        },
      ],
    };

    const resEmpty = reconcileVersionDocumentThreeWay({
      base,
      mine: mineEmpty,
      theirs: theirsOne,
    });
    expect(resEmpty.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(resEmpty.conflicts[0]?.reason).toMatch(/ambigua|vacía|recarga/i);
    expect(resEmpty.document.baremos[0]?.id).toBeNull();

    // 2. Code duplicado en mine (misma dimensión)
    const mineDup = {
      ...base,
      baremos: [
        {
          id: null,
          draftId: "bar-dup-1",
          status: "CREATED" as const,
          dimensionId: 1,
          code: "BAR-DUP",
          name: "Dup 1",
          description: "",
          normativeGroup: "",
          ranges: [],
        },
        {
          id: null,
          draftId: "bar-dup-2",
          status: "CREATED" as const,
          dimensionId: 1,
          code: "BAR-DUP",
          name: "Dup 2",
          description: "",
          normativeGroup: "",
          ranges: [],
        },
      ],
    };
    const theirsDupMatch = {
      ...base,
      baremos: [
        {
          id: 105,
          draftId: "baremo-105",
          status: "EXISTING" as const,
          dimensionId: 1,
          code: "BAR-DUP",
          name: "Dup 1",
          description: "",
          normativeGroup: "",
          ranges: [],
        },
      ],
    };

    const resDup = reconcileVersionDocumentThreeWay({
      base,
      mine: mineDup,
      theirs: theirsDupMatch,
    });
    expect(resDup.conflicts.length).toBeGreaterThanOrEqual(2);
    expect(resDup.conflicts.every((c) => /recarga/i.test(c.reason))).toBe(true);
    expect(resDup.document.baremos.every((b) => b.id === null)).toBe(true);
  });
});

describe("reconcileVersionDocumentThreeWay (F3-FIX-6)", () => {
  it("Hallazgo 1 (ALTO): ítem A con opción B/C vs ítem A/B con opción C no colisionan al borrar el subtest", () => {
    const base = createCleanDocument({ baremos: [] });
    base.subtests[0]!.items = [
      {
        ...base.subtests[0]!.items[0]!,
        id: 30,
        draftId: "item-a",
        code: "A",
        order: 1,
        answerKey: null,
        options: [
          {
            id: 40,
            draftId: "opt-bc",
            sourceId: null,
            status: "EXISTING",
            code: "B/C",
            text: "Original",
            order: 1,
            ordinalValue: 1,
            images: [],
          },
        ],
      },
      {
        ...base.subtests[0]!.items[0]!,
        id: 31,
        draftId: "item-ab",
        code: "A/B",
        order: 2,
        answerKey: null,
        options: [
          {
            id: 41,
            draftId: "opt-c",
            sourceId: null,
            status: "EXISTING",
            code: "C",
            text: "Sin cambios",
            order: 1,
            ordinalValue: 1,
            images: [],
          },
        ],
      },
    ];

    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1200));
    const mine = reducer(base, {
      type: "DELETE_SUBTEST",
      subtestDraftId: "sub-20",
    });

    const theirs = reducer(base, {
      type: "UPDATE_OPTION",
      subtestDraftId: "sub-20",
      itemDraftId: "item-a",
      optionDraftId: "opt-bc",
      patch: { text: "Editada en servidor" },
    });

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs });
    expect(result.conflicts.some((c) => c.kind === "subtest")).toBe(true);
    expect(
      result.conflicts.some((c) => c.kind === "option" && c.label.includes("B/C")),
    ).toBe(true);

    // Claves compuestas con separadores en sent.ts tampoco colisionan
    expect(sentKey.itemImage("sub", "A/B", "C")).not.toBe(
      sentKey.optionImage("sub", "A", "B", "C"),
    );
    expect(
      uploadSlotKey({ subtestDraftId: "sub", itemDraftId: "A/B", optionDraftId: null, order: 1 }),
    ).not.toBe(
      uploadSlotKey({ subtestDraftId: "sub", itemDraftId: "A", optionDraftId: "B", order: 1 }),
    );
    expect(baremoNaturalKey({ code: "total|X", dimensionId: null })).not.toBe(
      baremoNaturalKey({ code: "dim:1|X", dimensionId: 1 }),
    );
  });

  it("Hallazgo 2 (ALTO): imagen reemplazada tras 503 NO adopta el recurso obsoleto y conserva el archivo nuevo para PUT by-order", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1210));

    let mine = reducer(base, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-old",
        pendingFileId: "file-old",
        order: 2,
        altText: "Estímulo viejo",
        role: "ENUNCIADO",
        fileName: "vieja.png",
      },
    });

    const sent = createEmptySentSnapshot();
    const slotKey = uploadSlotKey({
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 2,
    });
    sent.uploads[slotKey] = {
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 2,
      pendingFileId: "file-old",
      fileName: "vieja.png",
      fileSize: 100,
      lastModified: 1000,
      altText: "Estímulo viejo",
      role: "ENUNCIADO",
    };

    // Usuario borra la imagen pendiente y adjunta otro archivo en el mismo orden
    mine = reducer(mine, {
      type: "DELETE_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      imageDraftId: "img-old",
    });
    mine = reducer(mine, {
      type: "ATTACH_ITEM_IMAGE",
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      image: {
        draftId: "img-new",
        pendingFileId: "file-new",
        order: 2,
        altText: "Estímulo nuevo",
        role: "ENUNCIADO",
        fileName: "nueva.png",
      },
    });

    // El servidor sí guardó la primera imagen (resourceId=901, id=777)
    const theirs = structuredClone(base);
    theirs.subtests[0]!.items[0]!.images.push({
      id: 777,
      draftId: "img-777",
      sourceId: null,
      resourceId: 901,
      pendingFileId: null,
      previewUrl: "/items/images/resources/901",
      status: "EXISTING",
      order: 2,
      altText: "Estímulo viejo",
      role: "ENUNCIADO",
      fileName: "vieja.png",
    });

    const pendingFiles = {
      "file-new": new File(["new-bytes"], "nueva.png", { type: "image/png", lastModified: 2000 }),
    };

    const result = reconcileVersionDocumentThreeWay({
      base,
      mine,
      theirs,
      sent,
      pendingFiles,
    });
    expect(result.conflicts).toEqual([]);
    const reconciledImg = result.document.subtests[0]!.items[0]!.images.find(
      (img) => img.order === 2,
    );
    expect(reconciledImg).toMatchObject({
      id: 777,
      resourceId: null,
      pendingFileId: "file-new",
      status: "UPDATED",
      fileName: "nueva.png",
    });
    expect(result.sent.uploads[slotKey]).toBeUndefined();
  });

  it("Hallazgo 2 (ALTO): si mine borró la imagen incierta sin adjuntar otra, marca la obsoleta como DELETED", () => {
    const base = createCleanDocument({ baremos: [] });
    const sent = createEmptySentSnapshot();
    const slotKey = uploadSlotKey({
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 2,
    });
    sent.uploads[slotKey] = {
      subtestDraftId: "sub-20",
      itemDraftId: "item-30",
      optionDraftId: null,
      order: 2,
      pendingFileId: "file-old",
      fileName: "vieja.png",
    };

    const theirs = structuredClone(base);
    theirs.subtests[0]!.items[0]!.images.push({
      id: 777,
      draftId: "img-777",
      sourceId: null,
      resourceId: 901,
      pendingFileId: null,
      previewUrl: "/items/images/resources/901",
      status: "EXISTING",
      order: 2,
      altText: "Estímulo viejo",
      role: "ENUNCIADO",
      fileName: "vieja.png",
    });

    const result = reconcileVersionDocumentThreeWay({ base, mine: base, theirs, sent });
    expect(result.conflicts).toEqual([]);
    const deletedImg = result.document.subtests[0]!.items[0]!.images.find(
      (img) => img.id === 777,
    );
    expect(deletedImg).toMatchObject({
      id: 777,
      status: "DELETED",
    });
    expect(result.sent.uploads[slotKey]).toBeUndefined();
  });

  it("Hallazgo 3 (MEDIO): código cambiado después del envío empareja por clave natural de sent en baremos, subtests, ítems y opciones", () => {
    const base = createCleanDocument({ baremos: [] });
    const reducer = createDocumentReducer(makeDeterministicDraftIdFactory(1230));

    let mine = reducer(base, {
      type: "ADD_BAREMO",
      input: { draftId: "bar-new", code: "BAR-TOT", name: "Total", dimensionId: null },
    });
    mine = reducer(mine, {
      type: "ADD_SUBTEST",
      input: { draftId: "sub-new", code: "ESP", name: "Espacial" },
    });
    mine = reducer(mine, {
      type: "ADD_ITEM",
      subtestDraftId: "sub-new",
      input: { draftId: "item-new", code: "IT-ESP" },
    });
    mine = reducer(mine, {
      type: "ADD_OPTION",
      subtestDraftId: "sub-new",
      itemDraftId: "item-new",
      input: { draftId: "opt-new", code: "OPT-A", text: "Uno", order: 1 },
    });

    const sentBaremo = mine.baremos[0]!;
    const sentSub = mine.subtests[1]!;
    const sentItem = sentSub.items[0]!;
    const sentOpt = sentItem.options[0]!;

    const sent = createEmptySentSnapshot();
    sent.nodes[sentKey.baremo("bar-new")] = {
      op: "CREATED",
      sig: canonicalBaremo(sentBaremo),
      naturalKey: baremoNaturalKey(sentBaremo),
    };
    sent.nodes[sentKey.subtest("sub-new")] = {
      op: "CREATED",
      sig: canonicalSubtest(sentSub, mine.version.randomizeItems),
      naturalKey: subtestNaturalKey(sentSub),
    };
    sent.nodes[sentKey.item("sub-new", "item-new")] = {
      op: "CREATED",
      sig: canonicalItem(sentItem),
      naturalKey: itemNaturalKey(sentItem),
    };
    sent.nodes[sentKey.option("sub-new", "item-new", "opt-new")] = {
      op: "CREATED",
      sig: canonicalOption(sentOpt),
      naturalKey: optionNaturalKey(sentOpt),
    };

    const theirs = structuredClone(base);
    theirs.baremos.push({ ...structuredClone(sentBaremo), id: 95, draftId: "baremo-95", status: "EXISTING" });
    theirs.subtests.push({
      ...structuredClone(sentSub),
      id: 25,
      draftId: "sub-25",
      status: "EXISTING",
      items: [
        {
          ...structuredClone(sentItem),
          id: 251,
          draftId: "item-251",
          status: "EXISTING",
          options: [
            {
              ...structuredClone(sentOpt),
              id: 2510,
              draftId: "opt-2510",
              status: "EXISTING",
            },
          ],
        },
      ],
    });

    // Usuario cambia los códigos después del envío incierto
    mine = reducer(mine, {
      type: "UPDATE_BAREMO",
      baremoDraftId: "bar-new",
      patch: { code: "bar-tot" },
    });
    mine = reducer(mine, {
      type: "UPDATE_SUBTEST",
      subtestDraftId: "sub-new",
      patch: { code: "esp" },
    });
    mine = reducer(mine, {
      type: "UPDATE_ITEM",
      subtestDraftId: "sub-new",
      itemDraftId: "item-new",
      patch: { code: "it-esp" },
    });
    mine = reducer(mine, {
      type: "UPDATE_OPTION",
      subtestDraftId: "sub-new",
      itemDraftId: "item-new",
      optionDraftId: "opt-new",
      patch: { code: "opt-a" },
    });

    const result = reconcileVersionDocumentThreeWay({ base, mine, theirs, sent });
    expect(result.conflicts).toEqual([]);
    expect(result.document.baremos[0]).toMatchObject({
      id: 95,
      code: "bar-tot",
      status: "UPDATED",
    });
    expect(result.document.subtests[1]).toMatchObject({
      id: 25,
      code: "esp",
      status: "UPDATED",
    });
    expect(result.document.subtests[1]!.items[0]).toMatchObject({
      id: 251,
      code: "it-esp",
      status: "UPDATED",
    });
    expect(result.document.subtests[1]!.items[0]!.options[0]).toMatchObject({
      id: 2510,
      code: "opt-a",
      status: "UPDATED",
    });
  });
});
