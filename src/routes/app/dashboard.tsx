import { createFileRoute } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";
import { DashboardScreen } from "../../app/components/screens/admin/dashboard";

export const Route = createFileRoute("/app/dashboard")({
  beforeLoad: requireRoutePermission("/app/dashboard"),
  component: DashboardScreen,
});
