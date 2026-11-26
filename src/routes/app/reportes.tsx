import { createFileRoute } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";
import { ReportsScreen } from "../../app/components/screens/admin/reports";

export const Route = createFileRoute("/app/reportes")({
  beforeLoad: requireRoutePermission("/app/reportes"),
  component: ReportsScreen,
});
