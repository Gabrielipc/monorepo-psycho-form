import { InlineNotice } from "./InlineNotice";

/**
 * Aviso honesto: el servidor aún no crea revisiones manuales al calificar ni aplica el puntaje
 * resuelto al resultado oficial (dependencia backend B23).
 */
export function PendingServerSupportNotice({ className }: { className?: string }) {
  return (
    <InlineNotice tone="info" title="Soporte pendiente en el servidor" className={className}>
      Las revisiones manuales generadas automáticamente al calificar y la aplicación del puntaje resuelto al resultado
      oficial dependen de soporte pendiente en el servidor. Por ahora esta pantalla puede no reflejar esas revisiones ni
      su efecto en el puntaje.
    </InlineNotice>
  );
}
