import * as React from "react";
import { AlertCircle, AlertTriangle, Info, Lock } from "lucide-react";

import type { ScoringStrategy } from "../../../api/schemas/instruments";
import { Alert, AlertDescription, AlertTitle } from "../../../app/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../app/components/ui/card";
import { Input } from "../../../app/components/ui/input";
import { Label } from "../../../app/components/ui/label";
import { StatusBadge } from "../../../app/components/ui/status-badge";
import { Switch } from "../../../app/components/ui/switch";
import { Textarea } from "../../../app/components/ui/textarea";
import { cn } from "../../../app/components/ui/utils";
import {
  type DocumentAction,
  type DocumentProblem,
  nodeKeyOf,
  type ValidationReport,
  type VersionDocument,
} from "../document";

export interface VersionMetaPanelProps {
  document: VersionDocument;
  validation: ValidationReport;
  readOnly: boolean;
  canEdit: boolean;
  canConfigureScoring: boolean;
  strategies: readonly ScoringStrategy[];
  strategiesLoading?: boolean;
  strategiesError?: string | null;
  onDispatch: (action: DocumentAction) => void;
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

const KNOWN_FIELDS = new Set(["number", "timeLimitSeconds", "instructions", "strategyId"]);

export function VersionMetaPanel({
  document,
  validation,
  readOnly,
  canEdit,
  canConfigureScoring,
  strategies,
  strategiesLoading = false,
  strategiesError = null,
  onDispatch,
}: VersionMetaPanelProps) {
  const isEditable = canEdit && !readOnly;
  const { version } = document;

  const numberId = React.useId();
  const timeLimitId = React.useId();
  const instructionsId = React.useId();
  const strategySelectId = React.useId();
  const randomizeSubtestsId = React.useId();
  const randomizeItemsId = React.useId();

  const versionProblems = React.useMemo(
    () => validation.byNodeKey[nodeKeyOf({ kind: "version" })] ?? [],
    [validation.byNodeKey],
  );

  const problemsByField = React.useMemo(() => {
    const grouped: Record<string, DocumentProblem[]> = {
      number: [],
      timeLimitSeconds: [],
      instructions: [],
      strategyId: [],
      other: [],
    };
    for (const problem of versionProblems) {
      if (problem.field && KNOWN_FIELDS.has(problem.field)) {
        grouped[problem.field]?.push(problem);
      } else {
        grouped.other.push(problem);
      }
    }
    return grouped;
  }, [versionProblems]);

  const hasError = (field: string): boolean =>
    (problemsByField[field] ?? []).some((problem) => problem.severity === "error");

  const currentStrategy = React.useMemo(
    () => strategies.find((s) => s.id === version.strategyId) ?? null,
    [strategies, version.strategyId],
  );

  const readOnlyStrategyLabel = React.useMemo(() => {
    if (version.strategyId === null) return "Sin estrategia asignada";
    if (currentStrategy) return `${currentStrategy.name} (${currentStrategy.code})`;
    return `Estrategia #${version.strategyId}`;
  }, [currentStrategy, version.strategyId]);

  const badgeStatus = version.status === "DESCONOCIDO" ? "BORRADOR" : version.status;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Card className="border-border bg-card shadow-[var(--shadow-xs)]">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs font-medium text-muted-foreground">
                {version.testCode}
              </span>
              <CardTitle className="text-base font-semibold text-foreground">
                {version.testName}
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Configuración general y parámetros de aplicación de la versión.
              </CardDescription>
            </div>
            <StatusBadge domain="version" status={badgeStatus} />
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-6 pt-6">
          {(readOnly || !canEdit) && (
            <Alert className="border-status-info-border bg-status-info-bg text-status-info-fg">
              <Info className="size-4" aria-hidden="true" />
              <AlertTitle className="text-sm font-medium">Modo solo lectura</AlertTitle>
              <AlertDescription className="text-xs text-status-info-fg">
                {readOnly
                  ? "Solo las versiones en estado Borrador pueden editarse."
                  : "No tienes permisos de edición sobre esta versión."}
              </AlertDescription>
            </Alert>
          )}

          {problemsByField.other.length > 0 && (
            <div className="rounded-lg border border-status-danger-border bg-status-danger-bg/60 p-3">
              <FieldMessages problems={problemsByField.other} />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={numberId}>
                <span>Número de versión</span>
                <span className="text-status-danger-fg" aria-hidden="true">
                  *
                </span>
              </Label>
              <Input
                id={numberId}
                type="text"
                value={version.number}
                disabled={!isEditable}
                aria-invalid={hasError("number")}
                placeholder="Ej. 1.0"
                onChange={(event) =>
                  onDispatch({
                    type: "UPDATE_VERSION_META",
                    patch: { number: event.target.value },
                  })
                }
              />
              <FieldMessages problems={problemsByField.number} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={timeLimitId}>Tiempo límite global (segundos)</Label>
              <Input
                id={timeLimitId}
                type="number"
                value={version.timeLimitSeconds === null ? "" : String(version.timeLimitSeconds)}
                disabled={!isEditable}
                aria-invalid={hasError("timeLimitSeconds")}
                placeholder="Sin límite global"
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  if (raw === "") {
                    onDispatch({
                      type: "UPDATE_VERSION_META",
                      patch: { timeLimitSeconds: null },
                    });
                    return;
                  }
                  const parsed = Number.parseInt(raw, 10);
                  onDispatch({
                    type: "UPDATE_VERSION_META",
                    patch: { timeLimitSeconds: Number.isFinite(parsed) ? parsed : null },
                  });
                }}
              />
              <p className="text-xs text-muted-foreground">
                Déjalo vacío si el tiempo se controla por subtest.
              </p>
              <FieldMessages problems={problemsByField.timeLimitSeconds} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={instructionsId}>Instrucciones generales</Label>
            <Textarea
              id={instructionsId}
              rows={4}
              value={version.instructions}
              disabled={!isEditable}
              aria-invalid={hasError("instructions")}
              placeholder="Indicaciones previas mostradas al participante antes de iniciar..."
              onChange={(event) =>
                onDispatch({
                  type: "UPDATE_VERSION_META",
                  patch: { instructions: event.target.value },
                })
              }
            />
            <FieldMessages problems={problemsByField.instructions} />
          </div>

          {/* Estrategia de calificación */}
          <div className="flex flex-col gap-2">
            <Label htmlFor={strategySelectId}>
              <span>Estrategia de calificación</span>
              <span className="text-status-danger-fg" aria-hidden="true">
                *
              </span>
            </Label>

            {!canConfigureScoring ? (
              <div className="flex flex-col gap-2">
                <div
                  aria-readonly="true"
                  data-testid="version-strategy-readonly"
                  className="flex h-9 items-center justify-between rounded-md border border-border bg-muted px-3 text-sm text-foreground"
                >
                  <span className="truncate">{readOnlyStrategyLabel}</span>
                  <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </div>
                <Alert className="border-status-warning-border bg-status-warning-bg text-status-warning-fg">
                  <Lock className="size-4" aria-hidden="true" />
                  <AlertTitle className="text-sm font-medium">
                    Configuración de calificación restringida
                  </AlertTitle>
                  <AlertDescription className="text-xs text-status-warning-fg">
                    Se requiere el permiso <span className="font-mono">CALIFICACION_CONFIGURAR</span>{" "}
                    para consultar o modificar la estrategia de calificación.
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <>
                {strategiesError && (
                  <Alert className="border-status-danger-border bg-status-danger-bg text-status-danger-fg">
                    <AlertCircle className="size-4" aria-hidden="true" />
                    <AlertTitle className="text-sm font-medium">
                      Error al cargar estrategias
                    </AlertTitle>
                    <AlertDescription className="text-xs text-status-danger-fg">
                      {strategiesError}
                    </AlertDescription>
                  </Alert>
                )}

                <select
                  id={strategySelectId}
                  value={version.strategyId === null ? "" : String(version.strategyId)}
                  disabled={!isEditable || strategiesLoading}
                  aria-invalid={hasError("strategyId")}
                  onChange={(event) => {
                    const raw = event.target.value;
                    onDispatch({
                      type: "UPDATE_VERSION_META",
                      patch: { strategyId: raw === "" ? null : Number(raw) },
                    });
                  }}
                  className={cn(
                    "border-input bg-input-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
                    "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
                  )}
                >
                  <option value="">
                    {strategiesLoading
                      ? "Cargando estrategias..."
                      : "Seleccionar estrategia de calificación..."}
                  </option>
                  {version.strategyId !== null && !currentStrategy && (
                    <option value={String(version.strategyId)}>
                      Estrategia #{version.strategyId}
                    </option>
                  )}
                  {strategies.map((strategy) => (
                    <option key={strategy.id} value={String(strategy.id)}>
                      {strategy.name} ({strategy.code})
                    </option>
                  ))}
                </select>
              </>
            )}

            <FieldMessages problems={problemsByField.strategyId} />
          </div>

          {/* Aleatorización */}
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
            <h3 className="text-sm font-semibold text-foreground">Orden y aleatorización</h3>

            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={randomizeSubtestsId}>Aleatorizar orden de subtests</Label>
                <p className="text-xs text-muted-foreground">
                  Presenta los subtests en orden distinto por participante.
                </p>
              </div>
              <Switch
                id={randomizeSubtestsId}
                checked={version.randomizeSubtests}
                disabled={!isEditable}
                onCheckedChange={(checked) =>
                  onDispatch({
                    type: "UPDATE_VERSION_META",
                    patch: { randomizeSubtests: checked },
                  })
                }
              />
            </div>

            <div className="border-t border-border" />

            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={randomizeItemsId}>Permitir aleatorización de ítems</Label>
                <p className="text-xs text-muted-foreground">
                  Desactivarlo también desactiva la aleatorización de ítems en todos los subtests.
                </p>
              </div>
              <Switch
                id={randomizeItemsId}
                checked={version.randomizeItems}
                disabled={!isEditable}
                onCheckedChange={(checked) =>
                  onDispatch({
                    type: "UPDATE_VERSION_META",
                    patch: { randomizeItems: checked },
                  })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
