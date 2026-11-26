import { createFileRoute } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";
import { AuditScreen } from "../../app/components/screens/admin/audit";

export const Route = createFileRoute("/app/auditoria")({
  beforeLoad: requireRoutePermission("/app/auditoria"),
  component: AuditScreen,
});
