import { createBrowserRouter, Navigate } from "react-router-dom";
import { Placeholder } from "./screens/Placeholder";
import { AdminLayout } from "./screens/admin/AdminLayout";
import { QuizLibrary } from "./screens/admin/QuizLibrary";
import { QuizEditor } from "./screens/admin/QuizEditor";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/admin" replace /> },
  { path: "/tv", element: <Placeholder titleKey="placeholder.tv" /> },
  { path: "/host", element: <Placeholder titleKey="placeholder.host" /> },
  { path: "/play", element: <Placeholder titleKey="placeholder.play" /> },
  { path: "/join/:code", element: <Placeholder titleKey="placeholder.join" /> },
  {
    path: "/admin",
    element: <AdminLayout />,
    children: [
      { index: true, element: <QuizLibrary /> },
      { path: "quiz/:id", element: <QuizEditor /> },
    ],
  },
  { path: "*", element: <Navigate to="/admin" replace /> },
]);
