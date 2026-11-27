import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "../../../app/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "../../../app/components/ui/dialog";
import { Input } from "../../../app/components/ui/input";
import { Textarea } from "../../../app/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../app/components/ui/table";
import { captureAccountScope } from "../../../store/accountScope";
import { PERMISSIONS } from "../../../store/permissions";
import { useStaffAuth } from "../../../store/staffAuth";
import { useCreateTest } from "../mutations";
import { useInstrumentPermissions } from "../permissions";
import { testsListQuery } from "../queries";

function NewTestDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useCreateTest();
  const navigate = useNavigate();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending || !code.trim() || !name.trim()) return;
    const scope = captureAccountScope();
    try {
      const test = await create.mutateAsync({ code, name, description: description.trim() || null });
      if (scope.isCurrent()) {
        onClose();
        void navigate({ to: "/app/instrumentos/$versionId", params: { versionId: String(test.id) } });
      }
    } catch {
      // El error de la mutación se muestra en el formulario.
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !create.isPending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo test</DialogTitle>
          <DialogDescription>Después de crear el test podrás agregar su primera versión.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <label className="grid gap-1 text-sm">
            Código
            <Input value={code} onChange={(event) => setCode(event.target.value)} required disabled={create.isPending} />
          </label>
          <label className="grid gap-1 text-sm">
            Nombre
            <Input value={name} onChange={(event) => setName(event.target.value)} required disabled={create.isPending} />
          </label>
          <label className="grid gap-1 text-sm">
            Descripción
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} disabled={create.isPending} />
          </label>
          {create.isError && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending || !code.trim() || !name.trim()}>
              {create.isPending ? "Creando…" : "Crear test"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InstrumentList() {
  const query = useQuery(testsListQuery());
  const { canEdit } = useInstrumentPermissions();
  const canReview = useStaffAuth((state) => state.user?.permissions.includes(PERMISSIONS.CALIFICACION_EJECUTAR));
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <section className="space-y-4" aria-label="Instrumentos">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Instrumentos</h1>
        <div className="flex flex-wrap gap-2">
          {canReview && <Button variant="outline" asChild><Link to="/app/revision-manual">Revisión manual</Link></Button>}
          {canEdit && <Button onClick={() => setCreateOpen(true)}>Nuevo test</Button>}
        </div>
      </div>
      {query.isPending ? <p role="status">Cargando instrumentos…</p> : query.isError ? (
        <div role="alert" className="space-y-2">
          <p>{query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>Reintentar</Button>
        </div>
      ) : query.data.length === 0 ? <p role="status">Todavía no hay tests registrados.</p> : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Código</TableHead><TableHead>Test</TableHead><TableHead>Estado</TableHead><TableHead>Acciones</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((test) => (
                <TableRow key={test.id}>
                  <TableCell className="font-mono">{test.code}</TableCell>
                  <TableCell className="font-medium">{test.name}</TableCell>
                  <TableCell>{test.status}</TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/app/instrumentos/$versionId" params={{ versionId: String(test.id) }} aria-label={`Ver versiones de ${test.name}`}>
                        Ver versiones
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {createOpen && canEdit && <NewTestDialog onClose={() => setCreateOpen(false)} />}
    </section>
  );
}
