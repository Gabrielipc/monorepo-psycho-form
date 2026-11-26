import { createFileRoute } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";
import { UsersScreen } from "../../app/components/screens/admin/users";

export const Route = createFileRoute("/app/usuarios")({
  beforeLoad: requireRoutePermission("/app/usuarios"),
  component: UsersScreen,
});
