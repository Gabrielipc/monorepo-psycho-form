import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Eye, MessageSquare, Search } from "lucide-react";

import type { Assignment } from "../../../api/schemas/sessions";
import { Button } from "../../../app/components/ui/button";
import { DataTable, type DataTableColumn } from "../../../app/components/ui/data-table";
import { EmptyState } from "../../../app/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../app/components/ui/dialog";
import { Input } from "../../../app/components/ui/input";
import { Progress } from "../../../app/components/ui/progress";
import { StatusBadge } from "../../../app/components/ui/status-badge";
import { cn } from "../../../app/components/ui/utils";
import { sessionAssignmentsQuery, sessionDetailQuery } from "../queries";
import { IncidenceForm } from "./IncidenceForm";
import { LinkStatusBadge } from "./LinkStatusBadge";
import { formatDateTime, formatRelative, formatTime } from "./format";
import {
  deriveKpis,
  matchesKpi,
  sortForMonitor,
  toAttemptStatus,
  useCanApplySessions,
  useCanGrade,
  useCanViewResults,
  type KpiKey,
} from "./model";

const KPI_DEFS: ReadonlyArray<{ key: KpiKey; label: string }> = [
  { key: "assigned", label: "Asignados" },
  { key: "inProgress", label: "En curso" },
  { key: "completed", label: "Completados" },
  { key: "interrupted", label: "Interrumpidos" },
  { key: "notStarted", label: "Sin iniciar" },
];

export function SessionMonitorTab({ sessionId }: { sessionId: number }) {
  const canApply = useCanApplySessions();
  const canViewResults = useCanViewResults();
  const canGrade = useCanGrade();

  const sessionQuery = useQuery(sessionDetailQuery(sessionId));
  const query = useQuery(sessionAssignmentsQuery(sessionId, { pollWhile: sessionQuery.data?.status }));
  const [kpiFilter, setKpiFilter] = useState<KpiKey>("assigned");
  const [search, setSearch] = useState("");
  const [noteTarget, setNoteTarget] = useState<Assignment | null>(null);

  const assignments = useMemo(() => query.data ?? [], [query.data]);
  const kpis = useMemo(() => deriveKpis(assignments), [assignments]);
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sortForMonitor(
      assignments.filter(
        (a) =>
          matchesKpi(a, kpiFilter) &&
          (needle === "" ||
            a.participantName.toLowerCase().includes(needle) ||
            (a.participantCode ?? "").toLowerCase().includes(needle)),
      ),
    );
  }, [assignments, kpiFilter, search]);

  const progressPercent = kpis.assigned === 0 ? 0 : Math.round((kpis.completed / kpis.assigned) * 100);

  const columns: DataTableColumn<Assignment>[] = [
    {
      id: "participant",
      header: "Participante",
      cell: (a) => (
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{a.participantName}</span>
          {a.participantCode && (
            <span className="font-mono text-xs text-muted-foreground">{a.participantCode}</span>
          )}
        </div>
      ),
    },
    {
      id: "subtest",
      header: "Subtest actual",
      cell: (a) => a.currentSubtestId ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: "progress",
      header: "Progreso",
      cell: (a) => (
        <div className="flex items-center gap-2">
          <Progress value={a.progress} className="h-1.5 w-24" aria-label={`Progreso de ${a.participantName}`} />
          <span className="text-xs tabular-nums text-muted-foreground">{Math.round(a.progress)}%</span>
        </div>
      ),
    },
    {
      id: "attemptState",
      header: "Intento",
      cell: (a) => <StatusBadge domain="attempt" status={toAttemptStatus(a.attemptState)} />,
    },
    {
      id: "linkStatus",
      header: "Enlace",
      cell: (a) => <LinkStatusBadge status={a.linkStatus} />,
    },
    {
      id: "lastActivity",
      header: "Última actividad",
      cell: (a) =>
        a.lastActivityAt ? (
          <time dateTime={a.lastActivityAt} title={formatDateTime(a.lastActivityAt)} className="text-sm tabular-nums">
            {formatRelative(a.lastActivityAt)}
          </time>
        ) : (
          <span className="text-muted-foreground">Sin actividad</span>
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (a) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {canApply && a.linkStatus !== "REVOCADO" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setNoteTarget(a)}
              aria-label={`Agregar nota para ${a.participantName}`}
            >
              <MessageSquare className="size-4" aria-hidden="true" />
              Nota
            </Button>
          )}
          {canViewResults && a.attemptId != null && (
            <Button asChild variant="ghost" size="sm">
              <Link
                to="/app/resultados/intento/$attemptId"
                params={{ attemptId: String(a.attemptId) }}
                aria-label={`Ver respuestas de ${a.participantName}`}
              >
                <Eye className="size-4" aria-hidden="true" />
                Ver respuestas
              </Link>
            </Button>
          )}
          {canGrade && a.attemptState === "completado" && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/app/calificaciones" search={{ sessionId, attemptId: a.attemptId ?? undefined }} aria-label={`Calificar a ${a.participantName}`}>
                <ClipboardCheck className="size-4" aria-hidden="true" />
                Calificar
              </Link>
            </Button>
          )}
        </div>
      ),
    },
  ];

  const hasFilters = kpiFilter !== "assigned" || search.trim() !== "";

  return (
    <div className="space-y-4">
      <section aria-label="Resumen de la sesión" className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <span>
            {kpis.completed}/{kpis.assigned} completados
          </span>
          <Progress
            value={progressPercent}
            className="h-1.5 w-40"
            aria-label="Avance global de la sesión"
          />
          <span>{progressPercent}%</span>
          {query.dataUpdatedAt > 0 && <span>Actualizado {formatTime(new Date(query.dataUpdatedAt).toISOString())}</span>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {KPI_DEFS.map(({ key, label }) => {
            const active = kpiFilter === key;
            const alert = key === "interrupted" && kpis.interrupted > 0;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setKpiFilter(active && key !== "assigned" ? "assigned" : key)}
                data-kpi={key}
                className={cn(
                  "rounded-lg border bg-card p-4 text-left shadow-[var(--shadow-xs)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/40",
                  active ? "border-primary" : "border-border",
                  alert && "border-warning-border bg-warning-muted/50",
                )}
              >
                <span className="block text-sm text-muted-foreground">{label}</span>
                <span className="block text-2xl font-semibold tabular-nums text-foreground">
                  {query.isSuccess ? kpis[key] : "–"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <DataTable
        columns={columns}
        rows={rows}
        density="comfortable"
        getRowId={(a) => String(a.assignmentId)}
        loading={query.isPending}
        error={query.isError ? query.error : null}
        onRetry={() => void query.refetch()}
        rowClassName={(a) =>
          a.attemptState === "interrumpido" ? "border-l-2 border-l-warning bg-warning-muted/30" : undefined
        }
        emptyState={
          hasFilters ? (
            <EmptyState
              title="Sin resultados para este filtro"
              description="Ningún participante coincide con la búsqueda o el indicador seleccionado."
              action={
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setKpiFilter("assigned");
                    setSearch("");
                  }}
                >
                  Limpiar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="Sin participantes asignados"
              description="Agrega participantes en la pestaña «Participantes y accesos»."
            />
          )
        }
        toolbar={
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar participante"
              aria-label="Buscar participante"
              className="w-64 pl-8"
            />
          </div>
        }
      />

      <Dialog open={noteTarget !== null} onOpenChange={(open) => !open && setNoteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nota de incidencia</DialogTitle>
            <DialogDescription>
              Queda registrada en la sesión y asociada al participante.
            </DialogDescription>
          </DialogHeader>
          {noteTarget && (
            <IncidenceForm
              sessionId={sessionId}
              participants={[
                {
                  id: noteTarget.participantId,
                  name: noteTarget.participantName,
                  ...(noteTarget.participantCode ? { code: noteTarget.participantCode } : {}),
                },
              ]}
              lockedParticipantId={noteTarget.participantId}
              submitLabel="Guardar nota"
              onRecorded={() => setNoteTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
