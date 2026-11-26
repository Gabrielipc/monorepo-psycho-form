import { Button } from "../../../app/components/ui/button";
import type { DocumentNodeRef, ValidationReport } from "../document";

export function ProblemsPanel({ report, onSelect }: {
  report: ValidationReport;
  onSelect: (node: DocumentNodeRef) => void;
}) {
  return (
    <section aria-label="Problemas de la versión" className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="font-semibold">Validación de la versión</h2>
      <p className="text-sm text-muted-foreground">
        {report.errors.length} errores · {report.warnings.length} advertencias
      </p>
      <ul className="space-y-2 text-sm">
        {report.checklist.map((check) => (
          <li key={check.id}>
            <Button variant="ghost" className="h-auto whitespace-normal text-left" onClick={() => onSelect(check.node)}>
              {check.passed ? "✓" : "Pendiente ·"} {check.label}
            </Button>
            {check.detail && <span className="px-2 text-muted-foreground">{check.detail}</span>}
          </li>
        ))}
      </ul>
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {[...report.errors, ...report.warnings].map((problem) => (
          <li key={problem.id}>
            <Button
              variant="link"
              className="h-auto whitespace-normal text-left"
              onClick={() => onSelect(problem.node)}
            >
              {problem.blocksSave
                ? "Impide guardar"
                : problem.severity === "error"
                  ? "Error"
                  : "Advertencia"}{" "}
              · {problem.message}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
