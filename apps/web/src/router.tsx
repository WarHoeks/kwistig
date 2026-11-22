import { createBrowserRouter, Navigate } from "react-router-dom";
import { AdminLayout } from "./screens/admin/AdminLayout";
import { QuizLibrary } from "./screens/admin/QuizLibrary";
import { QuizEditor } from "./screens/admin/QuizEditor";
import { SettingsPage } from "./screens/admin/SettingsPage";
import { TvScreen } from "./screens/tv/TvScreen";
import { HostScreen } from "./screens/host/HostScreen";
import { JoinScreen } from "./screens/play/JoinScreen";
import { PlayScreen } from "./screens/play/PlayScreen";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/host" replace /> },
  { path: "/tv", element: <TvScreen /> },
  { path: "/host", element: <HostScreen /> },
  { path: "/play", element: <PlayScreen /> },
  { path: "/join/:code", element: <JoinScreen /> },
  {
    path: "/admin",
    element: <AdminLayout />,
    children: [
      { index: true, element: <QuizLibrary /> },
      { path: "quiz/:id", element: <QuizEditor /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/host" replace /> },
]);
