import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { TestVersion } from "../../../api/schemas/instruments";
import { Button } from "../../../app/components/ui/button";
import { BuilderLayout } from "../builder/BuilderLayout";
import { useInstrumentPermissions } from "../permissions";
import { testsListQuery, versionsListQuery } from "../queries";
import { NewVersionDialog } from "./NewVersionDialog";

export function VersionList({ testId, revision }: { testId: number; revision?: number }) {
  const tests = useQuery(testsListQuery());
  const versions = useQuery(versionsListQuery(testId));
  const navigate = useNavigate();
  const { canEdit } = useInstrumentPermissions();
  const [create, setCreate] = useState<{ source?: TestVersion }>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [initialVersionId, setInitialVersionId] = useState<number>();
  const test = tests.data?.find((entry) => entry.id === testId);
  const list = [...(versions.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  const fallbackVersion = list.find((entry) => entry.status === "BORRADOR") ?? list[0];
  if (initialVersionId === undefined && fallbackVersion) setInitialVersionId(fallbackVersion.id);
  const selectedVersionId = revision ?? initialVersionId ?? fallbackVersion?.id;
  const active = list.find((entry) => entry.id === selectedVersionId);
  const params = { versionId: String(testId) };

  return (
    <div className="space-y-4">
      <Button variant="outline" asChild><Link to="/app/instrumentos">Volver a instrumentos</Link></Button>
      {test && <h1 className="text-xl font-semibold">{test.name} <span className="text-sm text-muted-foreground">{test.code}</span></h1>}
      {(tests.isError && !tests.data) || (versions.isError && !versions.data) ? (
        <div role="alert" className="space-y-2">
          <p>{tests.error?.message ?? versions.error?.message}</p>
          <Button variant="outline" onClick={() => { void tests.refetch(); void versions.refetch(); }}>Reintentar</Button>
        </div>
      ) : tests.isPending || versions.isPending ? (
        <p role="status">Cargando versiones…</p>
      ) : !test ? (
        <p role="alert">No se encontró el test.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            {list.length > 0 && (
              <label className="grid gap-1 text-sm">
                Versión del test
                <select
                  className="rounded-md border bg-background p-2"
                  value={active?.id ?? ""}
                  onChange={(event) => void navigate({
                    to: "/app/instrumentos/$versionId", params, search: { revision: Number(event.target.value) },
                  })}
                >
                  {!active && <option value="" disabled>Seleccionar versión</option>}
                  {list.map((entry) => <option key={entry.id} value={entry.id}>{entry.number} · {entry.status}</option>)}
                </select>
              </label>
            )}
            {canEdit && (
              <>
                <Button variant="outline" onClick={() => setCreate({})}>Nueva versión</Button>
                {active && <Button variant="outline" onClick={() => setCreate({ source: active })}>Nueva versión desde esta</Button>}
              </>
            )}
          </div>
          {warnings.length > 0 && (
            <ul role="status" className="list-disc space-y-1 rounded-md border p-3 pl-7 text-sm">
              {warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
          {active ? <BuilderLayout key={active.id} testId={testId} versionId={active.id} /> : (
            <p role="status">{list.length ? "La versión seleccionada no pertenece a este test." : "Este test todavía no tiene versiones."}</p>
          )}
          {create && (
            <NewVersionDialog
              testId={testId}
              source={create.source}
              versions={list}
              onClose={() => setCreate(undefined)}
              onCreated={(version, notices = []) => {
                setCreate(undefined);
                setWarnings(notices);
                void navigate({ to: "/app/instrumentos/$versionId", params, search: { revision: version.id } });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
