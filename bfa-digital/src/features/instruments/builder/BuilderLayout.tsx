import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { ApiError } from "../../../api/errors";
import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import { Button } from "../../../app/components/ui/button";
import { ConfirmDialog } from "../../../app/components/ui/confirm-dialog";
import { captureAccountScope } from "../../../store/accountScope";
import { BaremoEditor } from "../baremos/BaremoEditor";
import { useBuilderStore } from "../builderStore";
import {
  collectPendingImageUploads,
  detectOrderCollisions,
  isDocumentDirty,
  validateVersionDocument,
  type DocumentConflictNode,
} from "../document";
import {
  OrderCollisionError,
  PartialSaveError,
  SAVE_STEP_LABELS,
  VersionConflictError,
} from "../document/adapters";
import { useApproveVersion, usePublishVersion, useSaveVersionDocument } from "../mutations";
import { useInstrumentPermissions } from "../permissions";
import { PreviewRunner } from "../preview/PreviewRunner";
import { useScoringStrategies, versionDocumentQuery } from "../queries";
import { ItemEditor } from "./ItemEditor";
import { OutlineTree } from "./OutlineTree";
import { ProblemsPanel } from "./ProblemsPanel";
import { PublishDialog, type VersionTransition } from "./PublishDialog";
import { ReuseSubtestDialog } from "./ReuseSubtestDialog";
import { SubtestPanel } from "./SubtestPanel";
import { VersionMetaPanel } from "./VersionMetaPanel";

export function BuilderLayout({ testId, versionId }: { testId: number; versionId: number }) {
  const loaded = useQuery(versionDocumentQuery(versionId, { testId }));
  const strategies = useScoringStrategies();
  const permissions = useInstrumentPermissions();
  const store = useBuilderStore();
  const saveMutation = useSaveVersionDocument(versionId);
  const approveMutation = useApproveVersion(versionId, testId);
  const publishMutation = usePublishVersion(versionId, testId);
  const [transition, setTransition] = useState<VersionTransition>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reuseOpen, setReuseOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [conflicts, setConflicts] = useState<DocumentConflictNode[]>([]);
  const working = useRef(false);
  const leaving = useRef(false);
  const pending = saveMutation.isPending || approveMutation.isPending || publishMutation.isPending;
  const doc = store.versionId === versionId ? store.document : null;
  const dirty = doc !== null && isDocumentDirty(doc);
  const initialized = useRef(false);
  const mountedScope = useRef(captureAccountScope());

  useEffect(() => {
    return () => {
      initialized.current = false;
      if (useBuilderStore.getState().versionId === versionId) useBuilderStore.getState().reset();
    };
  }, [versionId]);

  useEffect(() => {
    const serverDoc = loaded.data?.document;
    const state = useBuilderStore.getState();
    if (!serverDoc || state.serverBaseline === serverDoc) return;
    if (!initialized.current) {
      initialized.current = true;
      state.initDocument(serverDoc);
    } else if (
      state.document &&
      ((!isDocumentDirty(state.document) && !state.reconciliationPending) ||
        serverDoc.version.status !== "BORRADOR")
    ) {
      state.commitSaved(serverDoc);
    }
  }, [loaded.data]);

  const hasUnpersistedFiles = doc !== null && collectPendingImageUploads(doc)
    .some(({ pendingFileId }) => pendingFileId in store.pendingFiles);
  useBlocker({
    shouldBlockFn: () => mountedScope.current.isCurrent() && working.current,
    enableBeforeUnload: () => working.current || hasUnpersistedFiles || (dirty && !store.autosaveSavedAt),
  });
  const navigation = useBlocker({
    shouldBlockFn: () => mountedScope.current.isCurrent() && !working.current && (hasUnpersistedFiles || (dirty && !store.autosaveSavedAt)),
    enableBeforeUnload: false,
    withResolver: true,
  });

  useEffect(() => {
    if (navigation.status === "idle") leaving.current = false;
  }, [navigation.status]);

  const orderCollisions = useMemo(
    () => (doc ? detectOrderCollisions(doc, store.serverBaseline) : []),
    [doc, store.serverBaseline],
  );

  if (!doc) {
    if (loaded.isError) {
      return (
        <div role="alert" className="space-y-2">
          <p>{loaded.error.message}</p>
          <Button variant="outline" onClick={() => void loaded.refetch()}>Reintentar carga</Button>
        </div>
      );
    }
    return <p role="status">Cargando documento de versión…</p>;
  }

  const readOnly = pending || doc.version.status !== "BORRADOR" || loaded.data?.version.status !== "BORRADOR";
  const validation = validateVersionDocument(doc, {
    hasUnsavedChanges: dirty,
    hasActiveScoringRules: loaded.data?.hasActiveScoringRules ?? false,
  });
  const selected = store.selectedNode;
  const subtest = selected.kind === "subtest" || selected.kind === "item"
    ? doc.subtests.find((entry) => entry.draftId === selected.subtestDraftId)
    : undefined;
  const item = selected.kind === "item" ? subtest?.items.find((entry) => entry.draftId === selected.itemDraftId) : undefined;
  const versionStatus = doc.version.status;
  const action = versionStatus === "APROBADO" ? "publish" : "approve";
  const canTransition = permissions.canPublish &&
    (versionStatus === "BORRADOR" || versionStatus === "EN_REVISION" || versionStatus === "APROBADO");
  const canEditDraft = !readOnly && (permissions.canEdit || permissions.canConfigureBaremos);
  const partialSave = store.partialSave;
  const isReconciliationPending =
    Boolean(partialSave?.reconciliationPending) || store.reconciliationPending;
  const canSave =
    !readOnly &&
    (dirty || isReconciliationPending) &&
    validation.canSave &&
    orderCollisions.length === 0 &&
    (permissions.canEdit || permissions.canConfigureBaremos);
  const canRetryReconciliation =
    isReconciliationPending &&
    !readOnly &&
    (permissions.canEdit || permissions.canConfigureBaremos);
  const dispatch = store.dispatch;

  async function save() {
    if (!doc || (!canSave && !canRetryReconciliation) || working.current) return;
    const scope = captureAccountScope();
    working.current = true;
    setError(undefined);
    setMessage(undefined);
    setConflicts([]);
    const previousPartial = partialSave;
    try {
      const fresh = await saveMutation.mutateAsync({
        document: doc,
        pendingFiles: store.getPendingFilesMap(),
        baselineDocument: store.serverBaseline ?? undefined,
        baselineSignature: store.baselineSignature,
        reconciliationPending: isReconciliationPending,
        sent: store.sent,
        completedSteps: previousPartial?.completedSteps,
        pendingSteps: previousPartial?.pendingSteps,
        onStepCommitted: (snapshot) => {
          if (scope.isCurrent()) {
            store.reconcilePartialSave(
              snapshot.document,
              snapshot.baselineDocument,
              snapshot.baselineSignature,
              {
                reconciliationPending: snapshot.reconciliationPending,
                ...(snapshot.reconciliationPending === false && !snapshot.step
                  ? { partialSave: null }
                  : {}),
                ...(snapshot.sent !== undefined ? { sent: snapshot.sent } : {}),
              },
            );
          }
        },
        permissions,
      });
      if (scope.isCurrent()) {
        store.commitSaved(fresh.document);
        setConflicts([]);
        setMessage("Versión guardada.");
      }
    } catch (cause) {
      if (!scope.isCurrent()) return;
      if (cause instanceof PartialSaveError) {
        const nextPartial = {
          message: cause.message,
          completedSteps: cause.completedSteps,
          pendingSteps: cause.pendingSteps,
          reconciliationPending: cause.reconciliationPending,
        };
        store.reconcilePartialSave(
          cause.document,
          cause.baselineDocument,
          cause.baselineSignature,
          {
            reconciliationPending: cause.reconciliationPending,
            partialSave: nextPartial,
            sent: cause.sent,
          },
        );
      } else if (cause instanceof VersionConflictError) {
        setConflicts(cause.conflicts);
        setError(cause.message);
      } else if (cause instanceof ApiError && cause.code === "VERSION_DOCUMENT_CHANGED") {
        setConflicts(
          (cause.details ?? []).map((label, idx) => ({
            kind: "version",
            node: { kind: "version" },
            nodeKey: `conflict-${idx}`,
            label,
            reason: "Cambio externo en el servidor.",
          })),
        );
        setError(cause.message);
      } else if (cause instanceof OrderCollisionError) {
        setError(cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : "No se pudo guardar la versión.");
      }
    } finally {
      working.current = false;
    }
  }

  async function changeStatus() {
    if (!canTransition || !transition || working.current) return;
    if (transition === "approve" ? !validation.canApprove : !validation.canPublish) return;
    const scope = captureAccountScope();
    working.current = true;
    setError(undefined);
    setMessage(undefined);
    try {
      const version = await (transition === "approve" ? approveMutation : publishMutation).mutateAsync();
      if (scope.isCurrent() && doc) {
        store.commitSaved({ ...doc, version: { ...doc.version, status: version.status } });
        setTransition(undefined);
        setMessage(version.status === "PUBLICADO" ? "Versión publicada." : "Versión aprobada.");
      }
    } catch (cause) {
      if (scope.isCurrent()) setError(cause instanceof Error ? cause.message : "No se pudo actualizar la versión.");
    } finally {
      working.current = false;
    }
  }

  const common = { document: doc, validation, readOnly, ...permissions, onDispatch: dispatch };
  const scoring = { strategies: strategies.data ?? [], strategiesLoading: strategies.isLoading,
    strategiesError: strategies.error?.message };
  const copyOptions = { canEdit: permissions.canEdit, canConfigureScoring: permissions.canConfigureScoring };

  return (
    <section aria-label="Editor de versión" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Versión {doc.version.number}</h2>
          <p role="status" className="text-sm text-muted-foreground">
            {versionStatus}{dirty ? " · Cambios pendientes" : ""}
            {dirty && store.autosaveSavedAt && " · Borrador guardado en este navegador"}
            {isReconciliationPending && " · Reconciliación pendiente"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEditDraft && (
            <>
              <Button variant="outline" disabled={!store.past.length} onClick={store.undo}>Deshacer</Button>
              <Button variant="outline" disabled={!store.future.length} onClick={store.redo}>Rehacer</Button>
            </>
          )}
          <Button variant="outline" disabled={pending} onClick={() => setPreviewOpen(true)}>Vista previa</Button>
          {(canEditDraft || saveMutation.isPending) && (
            <Button disabled={!canSave} onClick={() => void save()}>{saveMutation.isPending ? "Guardando…" : "Guardar borrador"}</Button>
          )}
        </div>
      </div>
      {dirty && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {store.autosaveRestored && <span>Se recuperó un borrador local. Si faltan imágenes, adjunta los archivos otra vez.</span>}
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDiscardOpen(true)}>Descartar cambios locales</Button>
        </div>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
      {dirty && !validation.canSave && (
        <Alert role="alert" className="border-status-danger-border bg-status-danger-bg text-status-danger-fg">
          <AlertTitle>No se puede guardar mientras existan conflictos de validación</AlertTitle>
          <AlertDescription className="space-y-1 text-xs text-status-danger-fg">
            <p>
              Hay {validation.saveErrors.length} conflicto(s) que impiden persistir en el servidor.
              Revisa cada nodo marcado en el panel de validación para resolverlos.
            </p>
          </AlertDescription>
        </Alert>
      )}
      {orderCollisions.length > 0 && (
        <Alert role="alert" className="border-status-warning-border bg-status-warning-bg text-status-warning-fg">
          <AlertTitle>Reordenamiento incompatible con guardado directo (B18)</AlertTitle>
          <AlertDescription className="space-y-2 text-xs text-status-warning-fg">
            <p>
              Los siguientes niveles intercambian posiciones ocupadas por registros ya guardados y
              colisionarían en un guardado simple (no se guardarán metadatos hasta resolverlo):
            </p>
            <ul className="list-disc space-y-1 pl-4">
              {orderCollisions.map((col) => (
                <li key={`${col.level}:${col.nodeKey}`}>
                  <button
                    type="button"
                    className="underline font-medium"
                    onClick={() => store.selectNode(col.node)}
                  >
                    {col.label}
                  </button>
                  {": "}
                  {col.entries.map((e) => `${e.code} (#${e.fromOrder > 0 ? e.fromOrder : "nuevo"} → #${e.toOrder})`).join(", ")}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending || !store.serverBaseline}
                onClick={() => {
                  if (!store.serverBaseline) return;
                  dispatch({ type: "REVERT_REORDERING", baseline: store.serverBaseline });
                  setError(undefined);
                }}
              >
                Revertir solo el reordenamiento
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {(partialSave !== null || isReconciliationPending) && (
        <Alert role="alert" className="border-status-danger-border bg-status-danger-bg text-status-danger-fg">
          <AlertTitle>
            {(partialSave?.pendingSteps.length ?? 0) > 0
              ? "Guardado parcial: se requiere reintentar lo pendiente"
              : "Reconciliación pendiente con el servidor"}
          </AlertTitle>
          <AlertDescription className="space-y-2 text-xs text-status-danger-fg">
            {partialSave?.message && <p>{partialSave.message}</p>}
            {isReconciliationPending && (
              <p>
                <strong>Reconciliación pendiente:</strong> no se pudo recargar el estado del
                servidor; al reintentar se recargará y reconciliará la línea base antes de
                continuar con los pasos pendientes.
              </p>
            )}
            {partialSave && partialSave.completedSteps.length > 0 && (
              <p>
                <strong>Pasos guardados:</strong>{" "}
                {partialSave.completedSteps.map((s) => SAVE_STEP_LABELS[s]).join(", ")}.
              </p>
            )}
            {partialSave && partialSave.pendingSteps.length > 0 && (
              <p>
                <strong>Pasos pendientes:</strong>{" "}
                {partialSave.pendingSteps.map((s) => SAVE_STEP_LABELS[s]).join(", ")}.
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || (isReconciliationPending ? !canRetryReconciliation : !canSave)}
              onClick={() => void save()}
            >
              {isReconciliationPending ? "Reintentar sincronización" : "Reintentar"}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {conflicts.length > 0 && (
        <Alert role="alert" className="border-status-danger-border bg-status-danger-bg text-status-danger-fg">
          <AlertTitle>Conflicto con cambios externos en el servidor (409)</AlertTitle>
          <AlertDescription className="space-y-2 text-xs text-status-danger-fg">
            <p>
              Los siguientes nodos fueron modificados en el servidor mientras trabajabas. Tus
              ediciones en nodos sin conflicto se conservan en el borrador:
            </p>
            <ul className="list-disc space-y-1 pl-4">
              {conflicts.map((conflict, index) => (
                <li key={`${conflict.nodeKey}:${index}`}>
                  <button
                    type="button"
                    className="underline font-medium"
                    onClick={() => store.selectNode(conflict.node)}
                  >
                    {conflict.label}
                  </button>
                  {`: ${conflict.reason}`}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {error && !transition && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <OutlineTree
          {...common}
          selectedNode={selected}
          onSelectNode={store.selectNode}
          onOpenReuseSubtest={() => setReuseOpen(true)}
        />
        <div className="min-w-0 space-y-4">
          {selected.kind === "version" && <VersionMetaPanel {...common} {...scoring} />}
          {selected.kind === "subtest" && subtest && (
            <SubtestPanel
              {...common}
              {...scoring}
              key={subtest.draftId}
              subtest={subtest}
              scoringRules={loaded.data?.scoringRulesBySubtestId[subtest.id ?? -1]}
              onSelectItem={(itemDraftId) => store.selectNode({ kind: "item", subtestDraftId: subtest.draftId, itemDraftId })}
            />
          )}
          {item && subtest && (
            <ItemEditor
              {...copyOptions}
              key={item.draftId}
              item={item}
              subtest={subtest}
              validation={validation}
              readOnly={readOnly}
              onDispatch={dispatch}
              onRegisterPendingFile={store.registerPendingFile}
              onRemovePendingFile={store.removePendingFile}
            />
          )}
          {selected.kind === "baremos" && (
            <BaremoEditor
              {...common}
              selectedBaremoDraftId={selected.baremoDraftId}
              onSelectBaremo={(baremoDraftId) => store.selectNode({ kind: "baremos", baremoDraftId })}
            />
          )}
          {selected.kind === "publish" && canTransition && (
            <Button
              disabled={pending || !(action === "approve" ? validation.canApprove : validation.canPublish)}
              onClick={() => { setError(undefined); setTransition(action); }}
            >
              {action === "approve" ? "Aprobar versión" : "Publicar versión"}
            </Button>
          )}
          <ProblemsPanel report={validation} onSelect={store.selectNode} />
        </div>
      </div>
      {previewOpen && <PreviewRunner document={doc} onClose={() => setPreviewOpen(false)} />}
      {reuseOpen && (
        <ReuseSubtestDialog
          onClose={() => setReuseOpen(false)}
          onImport={(template) => {
            if (readOnly || !permissions.canEdit) return;
            dispatch({
              type: "IMPORT_SUBTEST_CLONE",
              template: permissions.canConfigureScoring ? template : {
                ...template, items: template.items.map((entry) => ({ ...entry, answerKey: null })),
              },
            });
            const imported = useBuilderStore.getState().document?.subtests.at(-1);
            if (imported) store.selectNode({ kind: "subtest", subtestDraftId: imported.draftId });
            setReuseOpen(false);
          }}
        />
      )}
      {transition && (
        <PublishDialog
          action={transition}
          document={doc}
          validation={validation}
          pending={pending}
          error={error}
          onClose={() => { setTransition(undefined); setError(undefined); }}
          onConfirm={() => void changeStatus()}
        />
      )}
      <ConfirmDialog
        open={navigation.status === "blocked"}
        onOpenChange={(open) => { if (!open && navigation.status === "blocked" && !leaving.current) navigation.reset(); }}
        title="Salir del editor"
        description={hasUnpersistedFiles
          ? "Los archivos de imagen pendientes se perderán. Tendrás que adjuntarlos nuevamente para guardar."
          : "El navegador no pudo guardar el borrador local. Si sales, perderás los cambios."}
        confirmLabel="Salir del editor"
        onConfirm={() => {
          if (navigation.status !== "blocked") return;
          leaving.current = true;
          navigation.proceed();
        }}
      />
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        tone="danger"
        title="Descartar cambios locales"
        description="Se eliminarán las ediciones locales y se cargará la configuración del servidor."
        confirmLabel="Descartar"
        onConfirm={async () => {
          const scope = captureAccountScope();
          const result = await loaded.refetch();
          if (!scope.isCurrent()) return;
          if (result.isSuccess) {
            store.commitSaved(result.data.document);
            setConflicts([]);
            setError(undefined);
          } else {
            setError(result.error?.message ?? "No se pudo recargar la versión.");
          }
        }}
      />
    </section>
  );
}
