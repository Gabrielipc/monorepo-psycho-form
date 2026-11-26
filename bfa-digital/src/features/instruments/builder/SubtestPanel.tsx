import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";

import type { ScoringRule, ScoringStrategy } from "../../../api/schemas/instruments";
import { Badge } from "../../../app/components/ui/badge";
import { Button, buttonVariants } from "../../../app/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../app/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../app/components/ui/collapsible";
import { ConfirmDialog } from "../../../app/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../app/components/ui/dropdown-menu";
import { Input } from "../../../app/components/ui/input";
import { Label } from "../../../app/components/ui/label";
import { Switch } from "../../../app/components/ui/switch";
import { Textarea } from "../../../app/components/ui/textarea";
import { cn } from "../../../app/components/ui/utils";
import {
  createDefaultDraftId,
  type DocumentAction,
  type DocumentProblem,
  type DocumentSubtest,
  isActiveDraftNode,
  ITEM_TEMPLATE_LIST,
  type ItemTemplateId,
  nodeKeyOf,
  type ValidationReport,
  type VersionDocument,
} from "../document";

export interface SubtestPanelProps {
  document: VersionDocument;
  subtest: DocumentSubtest;
  validation: ValidationReport;
  readOnly: boolean;
  canEdit: boolean;
  canConfigureScoring: boolean;
  strategies: readonly ScoringStrategy[];
  scoringRules?: readonly ScoringRule[];
  onDispatch: (action: DocumentAction) => void;
  onSelectItem: (itemDraftId: string) => void;
  onDeleted?: () => void;
}

function FieldMessages({ problems }: { problems: readonly DocumentProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {problems.map((problem) =>
        problem.severity === "error" ? (
          <p
            key={problem.id}
            role="alert"
            className="flex items-center gap-1.5 text-xs text-status-danger-fg"
          >
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{problem.message}</span>
          </p>
        ) : (
          <p
            key={problem.id}
            className="flex items-center gap-1.5 text-xs text-status-warning-fg"
          >
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{problem.message}</span>
          </p>
        ),
      )}
    </div>
  );
}

const KNOWN_FIELDS = new Set([
  "code",
  "name",
  "description",
  "instructions",
  "timeLimitSeconds",
  "strategyId",
  "items",
]);

export function SubtestPanel({
  document,
  subtest,
  validation,
  readOnly,
  canEdit,
  canConfigureScoring,
  strategies,
  scoringRules = [],
  onDispatch,
  onSelectItem,
  onDeleted,
}: SubtestPanelProps) {
  const isEditable = canEdit && !readOnly;
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  const codeId = React.useId();
  const nameId = React.useId();
  const descriptionId = React.useId();
  const instructionsId = React.useId();
  const timeLimitId = React.useId();
  const requiredId = React.useId();
  const randomizeOptionsId = React.useId();
  const randomizeItemsId = React.useId();
  const strategySelectId = React.useId();

  const subtestKey = nodeKeyOf({ kind: "subtest", subtestDraftId: subtest.draftId });
  const subtestProblems = React.useMemo(
    () => validation.byNodeKey[subtestKey] ?? [],
    [subtestKey, validation.byNodeKey],
  );

  const problemsByField = React.useMemo(() => {
    const grouped: Record<string, DocumentProblem[]> = {
      code: [],
      name: [],
      description: [],
      instructions: [],
      timeLimitSeconds: [],
      strategyId: [],
      items: [],
      other: [],
    };
    for (const problem of subtestProblems) {
      if (problem.field && KNOWN_FIELDS.has(problem.field)) {
        grouped[problem.field]?.push(problem);
      } else {
        grouped.other.push(problem);
      }
    }
    return grouped;
  }, [subtestProblems]);

  const hasError = (field: string): boolean =>
    (problemsByField[field] ?? []).some((problem) => problem.severity === "error");

  const activeItems = React.useMemo(
    () => [...subtest.items].filter(isActiveDraftNode).sort((a, b) => a.order - b.order),
    [subtest.items],
  );

  const relevantRules = React.useMemo(
    () =>
      scoringRules.filter(
        (rule) =>
          rule.subtestId === null || (subtest.id !== null && rule.subtestId === subtest.id),
      ),
    [scoringRules, subtest.id],
  );

  const currentStrategy = React.useMemo(
    () => strategies.find((s) => s.id === subtest.strategyId) ?? null,
    [strategies, subtest.strategyId],
  );

  const readOnlyStrategyLabel = React.useMemo(() => {
    if (subtest.strategyId === null) return "Heredar de la versión";
    if (currentStrategy) return `${currentStrategy.name} (${currentStrategy.code})`;
    return `Estrategia #${subtest.strategyId}`;
  }, [currentStrategy, subtest.strategyId]);

  const versionAllowsRandomizeItems = document.version.randomizeItems;

  const handleAddItem = (templateId?: ItemTemplateId) => {
    if (!isEditable) return;
    const itemDraftId = createDefaultDraftId("item");
    onDispatch(
      templateId
        ? {
            type: "ADD_ITEM",
            subtestDraftId: subtest.draftId,
            templateId,
            input: { draftId: itemDraftId },
          }
        : {
            type: "ADD_ITEM",
            subtestDraftId: subtest.draftId,
            input: { draftId: itemDraftId },
          },
    );
    onSelectItem(itemDraftId);
  };

  const handleConfirmDelete = () => {
    onDispatch({ type: "DELETE_SUBTEST", subtestDraftId: subtest.draftId });
    onDeleted?.();
  };

  const updateSubtest = (
    patch: Extract<DocumentAction, { type: "UPDATE_SUBTEST" }>["patch"],
  ) => {
    onDispatch({
      type: "UPDATE_SUBTEST",
      subtestDraftId: subtest.draftId,
      patch,
    });
  };

  const deleteDescription = `Se eliminará el subtest "${subtest.name || subtest.code}" y sus ${activeItems.length} ítems activos del borrador actual.`;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Card className="border-border bg-card shadow-[var(--shadow-xs)]">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-medium text-muted-foreground">
                  {subtest.code || "SIN-CODIGO"}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Orden #{subtest.order}
                </span>
              </div>
              <CardTitle className="text-base font-semibold text-foreground">
                {subtest.name || "Subtest sin nombre"}
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Configuración, aleatorización y resumen de ítems del subtest.
              </CardDescription>
            </div>

            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!isEditable}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span>Eliminar subtest</span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-6 pt-6">
          {problemsByField.other.length > 0 && (
            <div className="rounded-lg border border-status-danger-border bg-status-danger-bg/60 p-3">
              <FieldMessages problems={problemsByField.other} />
            </div>
          )}

          {/* Código, nombre y tiempo límite */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={codeId}>
                <span>Código</span>
                <span className="text-status-danger-fg" aria-hidden="true">
                  *
                </span>
              </Label>
              <Input
                id={codeId}
                type="text"
                value={subtest.code}
                disabled={!isEditable}
                aria-invalid={hasError("code")}
                className="font-mono"
                onChange={(event) => updateSubtest({ code: event.target.value })}
              />
              <FieldMessages problems={problemsByField.code} />
            </div>

            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label htmlFor={nameId}>
                <span>Nombre del subtest</span>
                <span className="text-status-danger-fg" aria-hidden="true">
                  *
                </span>
              </Label>
              <Input
                id={nameId}
                type="text"
                value={subtest.name}
                disabled={!isEditable}
                aria-invalid={hasError("name")}
                onChange={(event) => updateSubtest({ name: event.target.value })}
              />
              <FieldMessages problems={problemsByField.name} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={timeLimitId}>Tiempo límite (segundos)</Label>
              <Input
                id={timeLimitId}
                type="number"
                value={subtest.timeLimitSeconds === null ? "" : String(subtest.timeLimitSeconds)}
                disabled={!isEditable}
                aria-invalid={hasError("timeLimitSeconds")}
                placeholder="Sin límite específico"
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  if (raw === "") {
                    updateSubtest({ timeLimitSeconds: null });
                    return;
                  }
                  const parsed = Number.parseInt(raw, 10);
                  updateSubtest({ timeLimitSeconds: Number.isFinite(parsed) ? parsed : null });
                }}
              />
              <FieldMessages problems={problemsByField.timeLimitSeconds} />
            </div>

            {/* Estrategia del subtest */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={strategySelectId}>Estrategia de calificación</Label>
              {!canConfigureScoring ? (
                <div className="flex flex-col gap-1.5">
                  <div
                    aria-readonly="true"
                    data-testid="subtest-strategy-readonly"
                    className="flex h-9 items-center justify-between rounded-md border border-border bg-muted px-3 text-sm text-foreground"
                  >
                    <span className="truncate">{readOnlyStrategyLabel}</span>
                    <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <p className="text-xs text-status-warning-fg">
                    Requiere permiso <span className="font-mono">CALIFICACION_CONFIGURAR</span>{" "}
                    para modificar la estrategia.
                  </p>
                </div>
              ) : (
                <select
                  id={strategySelectId}
                  value={subtest.strategyId === null ? "" : String(subtest.strategyId)}
                  disabled={!isEditable}
                  aria-invalid={hasError("strategyId")}
                  onChange={(event) => {
                    const raw = event.target.value;
                    updateSubtest({ strategyId: raw === "" ? null : Number(raw) });
                  }}
                  className={cn(
                    "border-input bg-input-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
                    "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
                  )}
                >
                  <option value="">Heredar de la versión</option>
                  {subtest.strategyId !== null && !currentStrategy && (
                    <option value={String(subtest.strategyId)}>
                      Estrategia #{subtest.strategyId}
                    </option>
                  )}
                  {strategies.map((strategy) => (
                    <option key={strategy.id} value={String(strategy.id)}>
                      {strategy.name} ({strategy.code})
                    </option>
                  ))}
                </select>
              )}
              <FieldMessages problems={problemsByField.strategyId} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descriptionId}>Descripción</Label>
            <Textarea
              id={descriptionId}
              rows={2}
              value={subtest.description}
              disabled={!isEditable}
              aria-invalid={hasError("description")}
              placeholder="Descripción interna o constructo evaluado..."
              onChange={(event) => updateSubtest({ description: event.target.value })}
            />
            <FieldMessages problems={problemsByField.description} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={instructionsId}>Instrucciones del subtest</Label>
            <Textarea
              id={instructionsId}
              rows={3}
              value={subtest.instructions}
              disabled={!isEditable}
              aria-invalid={hasError("instructions")}
              placeholder="Consigna mostrada antes de iniciar este subtest..."
              onChange={(event) => updateSubtest({ instructions: event.target.value })}
            />
            <FieldMessages problems={problemsByField.instructions} />
          </div>

          {/* Switches de comportamiento */}
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <h3 className="text-sm font-semibold text-foreground">Reglas de aplicación</h3>

            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={requiredId}>Subtest obligatorio</Label>
                <p className="text-xs text-muted-foreground">
                  El participante debe completar este subtest para cerrar el intento.
                </p>
              </div>
              <Switch
                id={requiredId}
                checked={subtest.required}
                disabled={!isEditable}
                onCheckedChange={(checked) => updateSubtest({ required: checked })}
              />
            </div>

            <div className="border-t border-border" />

            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={randomizeOptionsId}>Aleatorizar opciones</Label>
                <p className="text-xs text-muted-foreground">
                  Baraja el orden de las opciones en ítems de selección.
                </p>
              </div>
              <Switch
                id={randomizeOptionsId}
                checked={subtest.randomizeOptions}
                disabled={!isEditable}
                onCheckedChange={(checked) => updateSubtest({ randomizeOptions: checked })}
              />
            </div>

            <div className="border-t border-border" />

            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={randomizeItemsId}>Aleatorizar ítems del subtest</Label>
                <p className="text-xs text-muted-foreground">
                  {versionAllowsRandomizeItems
                    ? "Presenta los ítems de este subtest en orden aleatorio."
                    : "Deshabilitado porque la versión no permite aleatorizar ítems."}
                </p>
              </div>
              <Switch
                id={randomizeItemsId}
                checked={versionAllowsRandomizeItems ? subtest.randomizeItems : false}
                disabled={!isEditable || !versionAllowsRandomizeItems}
                onCheckedChange={(checked) => updateSubtest({ randomizeItems: checked })}
              />
            </div>
          </div>

          {/* Modo avanzado · Reglas de calificación */}
          <Collapsible
            open={advancedOpen}
            onOpenChange={setAdvancedOpen}
            className="rounded-lg border border-border bg-card"
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted/40"
              >
                <span className="flex items-center gap-2">
                  {advancedOpen ? (
                    <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span>Modo avanzado · Reglas de calificación</span>
                </span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {relevantRules.length} reglas
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t border-border px-4 py-3">
              <div className="flex flex-col gap-3 text-xs">
                <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
                  <span className="font-medium text-muted-foreground">Regla predeterminada</span>
                  <span className="font-mono text-foreground">
                    {subtest.defaultRuleId !== null
                      ? `#${subtest.defaultRuleId}`
                      : "Sin regla asignada"}
                  </span>
                </div>

                {relevantRules.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No hay reglas de calificación registradas para este subtest.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {relevantRules.map((rule) => (
                      <li
                        key={rule.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                      >
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-foreground">
                              #{rule.id}
                            </span>
                            <span className="font-medium text-foreground">{rule.ruleType}</span>
                          </div>
                          {rule.observation && (
                            <span className="text-muted-foreground">{rule.observation}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-xs tabular-nums">
                            Prioridad {rule.priority}
                          </Badge>
                          <Badge variant={rule.active ? "secondary" : "outline"} className="text-xs">
                            {rule.active ? "Activa" : "Inactiva"} · {rule.status}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Resumen de ítems */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">Ítems del subtest</h3>
                <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground tabular-nums">
                  {activeItems.length}
                </span>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={!isEditable}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    <span>+ Nuevo ítem</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuItem onSelect={() => handleAddItem()}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">Ítem en blanco</span>
                      <span className="text-xs text-muted-foreground">
                        Configuración vacía desde cero
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {ITEM_TEMPLATE_LIST.map((tpl) => (
                    <DropdownMenuItem key={tpl.id} onSelect={() => handleAddItem(tpl.id)}>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-medium">{tpl.label}</span>
                        <span className="text-xs text-muted-foreground">{tpl.description}</span>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <FieldMessages problems={problemsByField.items} />

            {activeItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Este subtest aún no tiene ítems activos.
              </div>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border">
                {activeItems.map((item) => {
                  const itemKey = nodeKeyOf({
                    kind: "item",
                    subtestDraftId: subtest.draftId,
                    itemDraftId: item.draftId,
                  });
                  const itemProblems = validation.byNodeKey[itemKey] ?? [];
                  const itemHasError = itemProblems.some((p) => p.severity === "error");
                  const itemHasWarning = itemProblems.some((p) => p.severity === "warning");

                  return (
                    <button
                      key={item.draftId}
                      type="button"
                      onClick={() => onSelectItem(item.draftId)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <FileText
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="shrink-0 font-mono text-xs font-semibold text-foreground">
                          {item.code}
                        </span>
                        <span className="truncate text-sm text-foreground">
                          {item.prompt.trim() || "Sin enunciado"}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground">{item.responseType}</span>
                        {itemHasError && (
                          <AlertCircle
                            className="size-3.5 text-status-danger-fg"
                            aria-label="Ítem con errores"
                          />
                        )}
                        {!itemHasError && itemHasWarning && (
                          <AlertTriangle
                            className="size-3.5 text-status-warning-fg"
                            aria-label="Ítem con advertencias"
                          />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        tone="danger"
        title="¿Eliminar subtest?"
        description={deleteDescription}
        confirmLabel="Eliminar subtest"
        cancelLabel="Cancelar"
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
