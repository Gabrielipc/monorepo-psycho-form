import { useId, useState } from "react";
import { AlertCircle, AlertTriangle, Copy, Trash2 } from "lucide-react";

import { Alert, AlertDescription } from "../../../app/components/ui/alert";
import { Button } from "../../../app/components/ui/button";
import { ConfirmDialog } from "../../../app/components/ui/confirm-dialog";
import { Input } from "../../../app/components/ui/input";
import { Label } from "../../../app/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../app/components/ui/select";
import { Switch } from "../../../app/components/ui/switch";
import { Textarea } from "../../../app/components/ui/textarea";
import { cn } from "../../../app/components/ui/utils";
import {
  isActiveDraftNode,
  nodeKeyOf,
  OPTION_RESPONSE_TYPES,
  type DocumentAction,
  type DocumentItem,
  type DocumentSubtest,
  type ItemType,
  type ResponseType,
  type ValidationReport,
} from "../document";
import { AnswerKeyField } from "./AnswerKeyField";
import { ImageField } from "./ImageField";
import { OptionList } from "./OptionList";

const ITEM_TYPE_OPTIONS: readonly { value: ItemType; label: string }[] = [
  { value: "SOLO_TEXTO", label: "Solo texto" },
  { value: "SOLO_IMAGEN", label: "Solo imagen" },
  { value: "TEXTO_E_IMAGEN", label: "Texto e imagen" },
  { value: "COMPARACION_IMAGENES", label: "Comparación de imágenes" },
  { value: "RAZONAMIENTO_VERBAL", label: "Razonamiento verbal" },
];

const RESPONSE_TYPE_OPTIONS: readonly { value: ResponseType; label: string }[] = [
  { value: "OPCION_UNICA", label: "Opción única" },
  { value: "OPCION_MULTIPLE", label: "Opción múltiple" },
  { value: "VERDADERO_FALSO", label: "Verdadero / Falso" },
  { value: "NUMERICA", label: "Numérica" },
  { value: "TEXTO_ABIERTO", label: "Texto abierto" },
];

export interface ItemEditorProps {
  subtest: DocumentSubtest;
  item: DocumentItem;
  validation: ValidationReport;
  readOnly: boolean;
  canEdit: boolean;
  canConfigureScoring: boolean;
  onDispatch: (action: DocumentAction) => void;
  onRegisterPendingFile: (file: File) => {
    pendingFileId: string;
    previewUrl: string;
    fileName: string;
  };
  onRemovePendingFile: (pendingFileId: string) => void;
  onDuplicated?: () => void;
  onDeleted?: () => void;
}

/**
 * Editor contextual de un ítem del builder: metadatos, estímulo visual,
 * lista de opciones (si aplica) y clave de respuesta.
 */
export function ItemEditor({
  subtest,
  item,
  validation,
  readOnly,
  canEdit,
  canConfigureScoring,
  onDispatch,
  onRegisterPendingFile,
  onRemovePendingFile,
  onDuplicated,
  onDeleted,
}: ItemEditorProps) {
  const editorId = useId();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const isLocked = readOnly || !canEdit;
  const itemNodeKey = nodeKeyOf({
    kind: "item",
    subtestDraftId: subtest.draftId,
    itemDraftId: item.draftId,
  });
  const itemProblems = validation.byNodeKey[itemNodeKey] ?? [];
  const generalItemProblems = itemProblems.filter(
    (p) => p.field !== "options" && !p.field?.startsWith("answerKey"),
  );

  const updateItem = (patch: Extract<DocumentAction, { type: "UPDATE_ITEM" }>["patch"]) => {
    onDispatch({
      type: "UPDATE_ITEM",
      subtestDraftId: subtest.draftId,
      itemDraftId: item.draftId,
      patch,
    });
  };

  const handleDuplicate = () => {
    onDispatch({
      type: "DUPLICATE_ITEM",
      subtestDraftId: subtest.draftId,
      itemDraftId: item.draftId,
    });
    onDuplicated?.();
  };

  const handleConfirmDelete = () => {
    for (const img of item.images) {
      if (isActiveDraftNode(img) && img.pendingFileId !== null) {
        onRemovePendingFile(img.pendingFileId);
      }
    }
    for (const opt of item.options) {
      if (!isActiveDraftNode(opt)) continue;
      for (const img of opt.images) {
        if (isActiveDraftNode(img) && img.pendingFileId !== null) {
          onRemovePendingFile(img.pendingFileId);
        }
      }
    }
    onDispatch({
      type: "DELETE_ITEM",
      subtestDraftId: subtest.draftId,
      itemDraftId: item.draftId,
    });
    onDeleted?.();
  };

  const codeInputId = `${editorId}-code`;
  const itemTypeId = `${editorId}-item-type`;
  const responseTypeId = `${editorId}-response-type`;
  const promptId = `${editorId}-prompt`;
  const instructionId = `${editorId}-instruction`;
  const baseScoreId = `${editorId}-base-score`;
  const timeLimitId = `${editorId}-time-limit`;
  const requiredId = `${editorId}-required`;
  const confidentialId = `${editorId}-confidential`;

  const codeError = itemProblems.find((p) => p.field === "code");
  const baseScoreError = itemProblems.find((p) => p.field === "baseScore");
  const timeLimitError = itemProblems.find((p) => p.field === "timeLimitSeconds");

  return (
    <div className="space-y-6" data-slot="item-editor">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">
            {subtest.name} › {item.code}
          </h2>
          <p className="text-xs text-muted-foreground">
            Ítem #{item.order} · Subtest {subtest.code}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isLocked}
            onClick={handleDuplicate}
            className="gap-1.5"
          >
            <Copy className="size-3.5" aria-hidden="true" />
            <span>Duplicar</span>
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={isLocked}
            onClick={() => setDeleteDialogOpen(true)}
            className="gap-1.5"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            <span>Eliminar ítem</span>
          </Button>
        </div>
      </div>

      {generalItemProblems.length > 0 && (
        <div className="space-y-2" aria-label="Validación del ítem">
          {generalItemProblems.map((problem) => {
            const isError = problem.severity === "error";
            return (
              <Alert
                key={problem.id}
                className={
                  isError
                    ? "border-status-danger-border bg-status-danger-bg text-status-danger-fg"
                    : "border-status-warning-border bg-status-warning-bg text-status-warning-fg"
                }
              >
                {isError ? (
                  <AlertCircle className="size-4" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="size-4" aria-hidden="true" />
                )}
                <AlertDescription
                  className={cn(
                    "text-xs",
                    isError ? "text-status-danger-fg" : "text-status-warning-fg",
                  )}
                >
                  {problem.message}
                </AlertDescription>
              </Alert>
            );
          })}
        </div>
      )}

      <section
        aria-labelledby={`${editorId}-general-heading`}
        className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-xs)]"
      >
        <h3 id={`${editorId}-general-heading`} className="text-sm font-semibold text-foreground">
          Configuración del ítem
        </h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor={codeInputId} className="text-sm font-medium text-foreground">
              Código del ítem <span className="text-status-danger-fg">*</span>
            </Label>
            <Input
              id={codeInputId}
              value={item.code}
              disabled={isLocked}
              aria-invalid={Boolean(codeError)}
              className="font-mono"
              onChange={(event) => updateItem({ code: event.target.value })}
            />
            {codeError && (
              <p className="text-xs text-status-danger-fg">{codeError.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={itemTypeId} className="text-sm font-medium text-foreground">
              Tipo de ítem
            </Label>
            <Select
              value={item.itemType}
              disabled={isLocked}
              onValueChange={(value) => updateItem({ itemType: value as ItemType })}
            >
              <SelectTrigger id={itemTypeId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ITEM_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={responseTypeId} className="text-sm font-medium text-foreground">
              Tipo de respuesta
            </Label>
            <Select
              value={item.responseType}
              disabled={isLocked}
              onValueChange={(value) => updateItem({ responseType: value as ResponseType })}
            >
              <SelectTrigger id={responseTypeId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESPONSE_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={promptId} className="text-sm font-medium text-foreground">
            Enunciado
          </Label>
          <Textarea
            id={promptId}
            value={item.prompt}
            disabled={isLocked}
            rows={3}
            placeholder="Pregunta o consigna principal del ítem"
            onChange={(event) => updateItem({ prompt: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={instructionId} className="text-sm font-medium text-foreground">
            Instrucción
          </Label>
          <Textarea
            id={instructionId}
            value={item.instruction}
            disabled={isLocked}
            rows={2}
            placeholder="Indicaciones específicas para el participante"
            onChange={(event) => updateItem({ instruction: event.target.value })}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={baseScoreId} className="text-sm font-medium text-foreground">
              Puntaje base
            </Label>
            <Input
              id={baseScoreId}
              type="number"
              min={0}
              step="any"
              value={item.baseScore}
              disabled={isLocked}
              aria-invalid={Boolean(baseScoreError)}
              className="tabular-nums"
              onChange={(event) => {
                const raw = event.target.value.trim();
                if (raw === "") return;
                const parsed = Number(raw);
                if (Number.isFinite(parsed) && parsed >= 0) {
                  updateItem({ baseScore: parsed });
                }
              }}
            />
            {baseScoreError && (
              <p className="text-xs text-status-danger-fg">{baseScoreError.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={timeLimitId} className="text-sm font-medium text-foreground">
              Tiempo límite (segundos)
            </Label>
            <Input
              id={timeLimitId}
              type="number"
              min={1}
              step={1}
              value={item.timeLimitSeconds ?? ""}
              disabled={isLocked}
              placeholder="Sin límite"
              aria-invalid={Boolean(timeLimitError)}
              className="tabular-nums"
              onChange={(event) => {
                const raw = event.target.value.trim();
                if (raw === "") {
                  updateItem({ timeLimitSeconds: null });
                  return;
                }
                const parsed = Number.parseInt(raw, 10);
                if (Number.isFinite(parsed) && parsed > 0) {
                  updateItem({ timeLimitSeconds: parsed });
                }
              }}
            />
            {timeLimitError && (
              <p className="text-xs text-status-danger-fg">{timeLimitError.message}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor={requiredId} className="text-sm font-medium text-foreground">
                Ítem obligatorio
              </Label>
              <p className="text-xs text-muted-foreground">
                El participante debe responder este ítem.
              </p>
            </div>
            <Switch
              id={requiredId}
              checked={item.required}
              disabled={isLocked}
              onCheckedChange={(checked) => updateItem({ required: checked })}
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <div className="space-y-0.5">
              <Label htmlFor={confidentialId} className="text-sm font-medium text-foreground">
                Confidencial
              </Label>
              <p className="text-xs text-muted-foreground">
                Protege el contenido fuera de sesión activa.
              </p>
            </div>
            <Switch
              id={confidentialId}
              checked={item.confidential}
              disabled={isLocked}
              onCheckedChange={(checked) => updateItem({ confidential: checked })}
            />
          </div>
        </div>
      </section>

      <section
        aria-labelledby={`${editorId}-images-heading`}
        className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-xs)]"
      >
        <div>
          <h3 id={`${editorId}-images-heading`} className="text-sm font-semibold text-foreground">
            Imágenes de estímulo
          </h3>
          <p className="text-xs text-muted-foreground">
            Adjunta láminas o figuras asociadas al enunciado del ítem (máximo 5 MB por archivo).
          </p>
        </div>

        <ImageField
          kind="item"
          images={item.images}
          readOnly={readOnly}
          canEdit={canEdit}
          onAttachFile={(file) => {
            const pending = onRegisterPendingFile(file);
            onDispatch({
              type: "ATTACH_ITEM_IMAGE",
              subtestDraftId: subtest.draftId,
              itemDraftId: item.draftId,
              image: {
                pendingFileId: pending.pendingFileId,
                previewUrl: pending.previewUrl,
                fileName: pending.fileName,
                altText: "",
              },
            });
          }}
          onUpdateImage={(imageDraftId, patch) =>
            onDispatch({
              type: "UPDATE_ITEM_IMAGE",
              subtestDraftId: subtest.draftId,
              itemDraftId: item.draftId,
              imageDraftId,
              patch,
            })
          }
          onDeleteImage={(imageDraftId) => {
            const target = item.images.find((img) => img.draftId === imageDraftId);
            if (target?.pendingFileId !== null && target?.pendingFileId !== undefined) {
              onRemovePendingFile(target.pendingFileId);
            }
            onDispatch({
              type: "DELETE_ITEM_IMAGE",
              subtestDraftId: subtest.draftId,
              itemDraftId: item.draftId,
              imageDraftId,
            });
          }}
        />
      </section>

      {OPTION_RESPONSE_TYPES.has(item.responseType) && (
        <div className="rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-xs)]">
          <OptionList
            subtestDraftId={subtest.draftId}
            subtestDefaultRuleId={subtest.defaultRuleId}
            item={item}
            readOnly={readOnly}
            canEdit={canEdit}
            canConfigureScoring={canConfigureScoring}
            problems={itemProblems}
            onDispatch={onDispatch}
            onRegisterPendingFile={onRegisterPendingFile}
            onRemovePendingFile={onRemovePendingFile}
          />
        </div>
      )}

      <AnswerKeyField
        subtestDraftId={subtest.draftId}
        subtestDefaultRuleId={subtest.defaultRuleId}
        item={item}
        readOnly={readOnly}
        canEdit={canEdit}
        canConfigureScoring={canConfigureScoring}
        problems={itemProblems}
        onDispatch={onDispatch}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        tone="danger"
        title="¿Eliminar ítem?"
        description={`Se eliminará el ítem "${item.code}" junto con sus opciones, imágenes y clave de respuesta.`}
        confirmLabel="Eliminar ítem"
        cancelLabel="Cancelar"
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
