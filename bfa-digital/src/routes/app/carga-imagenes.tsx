import { createFileRoute } from "@tanstack/react-router";
import { requireRoutePermission } from "../../store/routePermissions";
import { ImageUploadScreen } from "../../app/components/screens/admin/image-upload";

export const Route = createFileRoute("/app/carga-imagenes")({
  beforeLoad: requireRoutePermission("/app/carga-imagenes"),
  component: ImageUploadScreen,
});
