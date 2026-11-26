import { createFileRoute } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";
import { ReviewTrayScreen } from "../../app/components/screens/admin/review-tray";

export const Route = createFileRoute("/app/revision-manual")({
  beforeLoad: requireRoutePermission("/app/revision-manual"),
  component: ReviewTrayScreen,
});
