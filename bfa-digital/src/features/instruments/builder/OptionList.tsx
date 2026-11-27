import { useId, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  GripVertical,
  Info,
  Plus,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription } from "../../../app/components/ui/alert";
import { Badge } from "../../../app/components/ui/badge";
import { Button } from "../../../app/components/ui/button";
import { Input } from "../../../app/components/ui/input";
import { Label } from "../../../app/components/ui/label";
import { cn } from "../../../app/components/ui/utils";
import {
  isActiveDraftNode,
  SINGLE_KEY_OPTION_RESPONSE_TYPES,
  type DocumentAction,
  type DocumentItem,
  type DocumentOption,
  type DocumentProblem,
} from "../document";
import { ImageField } from "./ImageField";

export interface OptionListProps {
  subtestDraftId: string;
  subtestDefaultRuleId: number | null;
  item: DocumentItem;
  readOnly: boolean;
  canEdit: boolean;
  canConfigureScoring: boolean;
  problems?: readonly DocumentProblem[];
  onDispatch: (action: DocumentAction) => void;
  onRegisterPendingFile: (file: File) => {
    pendingFileId: string;
    previewUrl: string;
    fileName: string;
  };
  onRemovePendingFile: (pendingFileId: string) => void;
}

/**
 * Lista editable de opciones de respuesta con selección de clave integrada,
 * reordenamiento por DnD HTML5 y botones accesibles, e imágenes por opción.
 */
export function OptionList({
  subtestDraftId,
  subtestDefaultRuleId,
  item,
  readOnly,
  canEdit,
  canConfigureScoring,
  problems = [],
  onDispatch,
  onRegisterPendingFile,
  onRemovePendingFile,
}: OptionListProps) {
  const listId = useId();
  const [draggedDraftId, setDraggedDraftId] = useState<string | null>(null);
  const [dragOverDraftId, setDragOverDraftId] = useState<string | null>(null);

  const isLocked = readOnly || !canEdit;
  const canEditKey = !readOnly && canEdit && (subtestDefaultRuleId !== null || canConfigureScoring);
  const isSingleKeyType = SINGLE_KEY_OPTION_RESPONSE_TYPES.has(item.responseType);

  const rawActiveOptions = item.options.filter(isActiveDraftNode);
  const activeOptions = [...rawActiveOptions].sort((a, b) => a.order - b.order);
  const codeCounts = new Map<string, number>();
  for (const opt of activeOptions) {
    const normalized = opt.code.trim().toUpperCase();
    if (normalized) {
      codeCounts.set(normalized, (codeCounts.get(normalized) ?? 0) + 1);
    }
  }
  const activeKey = item.answerKey && isActiveDraftNode(item.answerKey) ? item.answerKey : null;
  const optionProblems = problems.filter((problem) => problem.field === "options");

  const isOptionCorrect = (option: DocumentOption): boolean => {
    if (!activeKey || activeKey.requiresManualReview) return false;
    if (activeKey.correctOptionDraftId !== null) {
      return activeKey.correctOptionDraftId === option.draftId;
    }
    return activeKey.correctOptionId !== null && option.id === activeKey.correctOptionId;
  };

  const moveOptionToSortedIndex = (sourceDraftId: string, targetSortedIndex: number) => {
    const targetOption = activeOptions[targetSortedIndex];
    if (!targetOption) return;
    const rawTargetIndex = rawActiveOptions.findIndex((o) => o.draftId === targetOption.draftId);
    if (rawTargetIndex < 0) return;

    onDispatch({
      type: "MOVE_OPTION",
      subtestDraftId,
      itemDraftId: item.draftId,
      optionDraftId: sourceDraftId,
      toIndex: rawTargetIndex,
    });
  };

  const handleDeleteOption = (option: DocumentOption) => {
    for (const img of option.images) {
      if (isActiveDraftNode(img) && img.pendingFileId !== null) {
        onRemovePendingFile(img.pendingFileId);
      }
    }
    onDispatch({
      type: "DELETE_OPTION",
      subtestDraftId,
      itemDraftId: item.draftId,
      optionDraftId: option.draftId,
    });
  };

  return (
    <section aria-labelledby={`${listId}-heading`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id={`${listId}-heading`} className="text-sm font-semibold text-foreground">
            Opciones de respuesta
          </h3>
          <p className="text-xs text-muted-foreground">
            {isSingleKeyType
              ? "Edita las opciones y marca la opción correcta directamente en la fila."
              : "Edita las opciones disponibles y su orden de presentación."}
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isLocked}
          onClick={() =>
            onDispatch({
              type: "ADD_OPTION",
              subtestDraftId,
              itemDraftId: item.draftId,
            })
          }
          className="gap-1.5"
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>+ Añadir opción</span>
        </Button>
      </div>

      {!readOnly && canEdit && !canEditKey && isSingleKeyType && (
        <Alert className="border-status-info-border bg-status-info-bg text-status-info-fg">
          <Info className="size-4" aria-hidden="true" />
          <AlertDescription className="text-xs text-status-info-fg">
            Marcar la clave en un subtest sin regla previa requiere el permiso{" "}
            <code className="font-mono font-semibold">CALIFICACION_CONFIGURAR</code>.
          </AlertDescription>
        </Alert>
      )}

      {optionProblems.length > 0 && (
        <div className="space-y-2">
          {optionProblems.map((problem) => {
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

      {activeOptions.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-center text-xs text-muted-foreground">
          Este ítem no tiene opciones activas. Añade al menos 2 opciones.
        </div>
      ) : (
        <div
          role={isSingleKeyType ? "radiogroup" : undefined}
          aria-label={isSingleKeyType ? "Opciones de respuesta" : undefined}
          className="space-y-3"
        >
          {activeOptions.map((opt, index) => {
            const correct = isSingleKeyType && isOptionCorrect(opt);
            const codeInputId = `${listId}-code-${opt.draftId}`;
            const textInputId = `${listId}-text-${opt.draftId}`;
            const ordinalInputId = `${listId}-ordinal-${opt.draftId}`;
            const isDragging = draggedDraftId === opt.draftId;
            const isDragOver = dragOverDraftId === opt.draftId && draggedDraftId !== opt.draftId;

            return (
              <div
                key={opt.draftId}
                data-slot="option-row"
                data-option-id={opt.draftId}
                draggable={!isLocked}
                onDragStart={(event) => {
                  if (isLocked) {
                    event.preventDefault();
                    return;
                  }
                  setDraggedDraftId(opt.draftId);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", opt.draftId);
                }}
                onDragOver={(event) => {
                  if (isLocked) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (dragOverDraftId !== opt.draftId) {
                    setDragOverDraftId(opt.draftId);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverDraftId === opt.draftId) {
                    setDragOverDraftId(null);
                  }
                }}
                onDrop={(event) => {
                  if (isLocked) return;
                  event.preventDefault();
                  const sourceId = draggedDraftId || event.dataTransfer.getData("text/plain");
                  setDraggedDraftId(null);
                  setDragOverDraftId(null);
                  if (sourceId && sourceId !== opt.draftId) {
                    moveOptionToSortedIndex(sourceId, index);
                  }
                }}
                onDragEnd={() => {
                  setDraggedDraftId(null);
                  setDragOverDraftId(null);
                }}
                className={cn(
                  "rounded-lg border p-3.5 transition-colors shadow-[var(--shadow-xs)]",
                  correct
                    ? "border-status-success-border bg-status-success-bg/40"
                    : "border-border bg-card",
                  isDragging && "opacity-60",
                  isDragOver && "border-primary ring-2 ring-ring/30",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center text-muted-foreground",
                        !isLocked && "cursor-grab",
                      )}
                      aria-hidden="true"
                    >
                      <GripVertical className="size-4" />
                    </span>

                    {isSingleKeyType && (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={correct}
                        aria-label={`Marcar opción ${opt.code} como correcta`}
                        disabled={!canEditKey}
                        onClick={() =>
                          onDispatch({
                            type: "SET_CORRECT_OPTION",
                            subtestDraftId,
                            itemDraftId: item.draftId,
                            optionDraftId: opt.draftId,
                          })
                        }
                        className={cn(
                          "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                          correct
                            ? "border-status-success-border bg-status-success-bg text-status-success-fg"
                            : "border-input bg-card text-foreground hover:bg-muted",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "size-3 rounded-full border",
                            correct
                              ? "border-status-success-solid bg-status-success-solid"
                              : "border-border-strong bg-card",
                          )}
                        />
                        <span>{correct ? "Clave correcta" : "Marcar correcta"}</span>
                      </button>
                    )}

                    {correct && (
                      <Badge className="border-status-success-border bg-status-success-bg text-status-success-fg">
                        <CheckCircle2 className="size-3" aria-hidden="true" />
                        <span>Correcta</span>
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Subir opción"
                      disabled={isLocked || index === 0}
                      onClick={() => moveOptionToSortedIndex(opt.draftId, index - 1)}
                      className="size-8"
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Bajar opción"
                      disabled={isLocked || index === activeOptions.length - 1}
                      onClick={() => moveOptionToSortedIndex(opt.draftId, index + 1)}
                      className="size-8"
                    >
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Eliminar opción"
                      disabled={isLocked}
                      onClick={() => handleDeleteOption(opt)}
                      className="h-8 gap-1 px-2 text-xs text-destructive hover:bg-status-danger-bg hover:text-status-danger-fg"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      <span>Eliminar opción</span>
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <div className="space-y-1 sm:col-span-3">
                    <Label htmlFor={codeInputId} className="text-xs font-medium text-foreground">
                      Código
                    </Label>
                    <Input
                      id={codeInputId}
                      value={opt.code}
                      disabled={isLocked}
                      aria-invalid={
                        opt.code.trim() === "" ||
                        (codeCounts.get(opt.code.trim().toUpperCase()) ?? 0) > 1
                      }
                      className="font-mono"
                      onChange={(event) =>
                        onDispatch({
                          type: "UPDATE_OPTION",
                          subtestDraftId,
                          itemDraftId: item.draftId,
                          optionDraftId: opt.draftId,
                          patch: { code: event.target.value },
                        })
                      }
                    />
                  </div>

                  <div className="space-y-1 sm:col-span-6">
                    <Label htmlFor={textInputId} className="text-xs font-medium text-foreground">
                      Texto
                    </Label>
                    <Input
                      id={textInputId}
                      value={opt.text}
                      disabled={isLocked}
                      placeholder="Texto visible de la opción"
                      onChange={(event) =>
                        onDispatch({
                          type: "UPDATE_OPTION",
                          subtestDraftId,
                          itemDraftId: item.draftId,
                          optionDraftId: opt.draftId,
                          patch: { text: event.target.value },
                        })
                      }
                    />
                  </div>

                  <div className="space-y-1 sm:col-span-3">
                    <Label htmlFor={ordinalInputId} className="text-xs font-medium text-foreground">
                      Valor ordinal
                    </Label>
                    <Input
                      id={ordinalInputId}
                      type="number"
                      step="any"
                      value={opt.ordinalValue ?? ""}
                      disabled={isLocked}
                      placeholder="Opcional"
                      className="tabular-nums"
                      onChange={(event) => {
                        const raw = event.target.value.trim();
                        if (raw === "") {
                          onDispatch({
                            type: "UPDATE_OPTION",
                            subtestDraftId,
                            itemDraftId: item.draftId,
                            optionDraftId: opt.draftId,
                            patch: { ordinalValue: null },
                          });
                          return;
                        }
                        const parsed = Number(raw);
                        if (Number.isFinite(parsed)) {
                          onDispatch({
                            type: "UPDATE_OPTION",
                            subtestDraftId,
                            itemDraftId: item.draftId,
                            optionDraftId: opt.draftId,
                            patch: { ordinalValue: parsed },
                          });
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="mt-3 border-t border-border pt-3">
                  <ImageField
                    kind="option"
                    compact
                    images={opt.images}
                    readOnly={readOnly}
                    canEdit={canEdit}
                    onAttachFile={(file) => {
                      const pending = onRegisterPendingFile(file);
                      onDispatch({
                        type: "ATTACH_OPTION_IMAGE",
                        subtestDraftId,
                        itemDraftId: item.draftId,
                        optionDraftId: opt.draftId,
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
                        type: "UPDATE_OPTION_IMAGE",
                        subtestDraftId,
                        itemDraftId: item.draftId,
                        optionDraftId: opt.draftId,
                        imageDraftId,
                        patch,
                      })
                    }
                    onDeleteImage={(imageDraftId) => {
                      const target = opt.images.find((img) => img.draftId === imageDraftId);
                      if (target?.pendingFileId !== null && target?.pendingFileId !== undefined) {
                        onRemovePendingFile(target.pendingFileId);
                      }
                      onDispatch({
                        type: "DELETE_OPTION_IMAGE",
                        subtestDraftId,
                        itemDraftId: item.draftId,
                        optionDraftId: opt.draftId,
                        imageDraftId,
                      });
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
