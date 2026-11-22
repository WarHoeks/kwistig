import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import "./i18n";
import "./index.css";
import { router } from "./router";
import { ConfirmProvider } from "./components/ConfirmDialog";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfirmProvider>
      <RouterProvider router={router} />
    </ConfirmProvider>
  </StrictMode>,
);
