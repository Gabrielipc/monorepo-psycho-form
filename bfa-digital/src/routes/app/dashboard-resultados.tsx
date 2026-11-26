import { createFileRoute } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";
import { ResultsDashboardScreen } from "../../app/components/screens/admin/results-dashboard";

export const Route = createFileRoute("/app/dashboard-resultados")({
  beforeLoad: requireRoutePermission("/app/dashboard-resultados"),
  component: ResultsDashboardScreen,
});
