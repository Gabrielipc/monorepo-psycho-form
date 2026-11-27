import { createFileRoute, notFound } from "@tanstack/react-router";
import { useStaffAuth } from "../../store/staffAuth";
import { VersionList } from "../../features/instruments/versions/VersionList";

export const Route = createFileRoute("/app/instrumentos/$versionId")({
  validateSearch: (search: Record<string, unknown>): { revision?: number } => {
    const revision = Number(search.revision);
    return Number.isSafeInteger(revision) && revision > 0 ? { revision } : {};
  },
  beforeLoad: ({ params }) => {
    if (!/^[1-9]\d*$/.test(params.versionId) || !Number.isSafeInteger(Number(params.versionId))) {
      throw notFound();
    }
  },
  component: InstrumentVersionRoute,
});

function InstrumentVersionRoute() {
  const { versionId } = Route.useParams();
  const { revision } = Route.useSearch();
  const sessionId = useStaffAuth((state) => state.sessionId);
  // La URL histórica identifica al test; revision identifica a la versión seleccionada.
  return <VersionList key={`${sessionId}:${versionId}`} testId={Number(versionId)} revision={revision} />;
}
