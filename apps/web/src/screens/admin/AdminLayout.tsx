import { Link, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PinGate } from "../../components/PinGate";
import { LanguageToggle } from "../../components/LanguageToggle";

export function AdminLayout() {
  const { t } = useTranslation();
  return (
    <PinGate>
      {(logout) => (
        <div className="min-h-screen">
          <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/90 backdrop-blur">
            <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
              <Link to="/admin" className="flex items-baseline gap-2">
                <span className="font-display text-2xl text-gold-400">{t("app.name")}</span>
                <span className="text-sm text-ink-400">{t("admin.title")}</span>
              </Link>
              <div className="ml-auto flex items-center gap-3">
                <LanguageToggle />
                <button type="button" className="btn-ghost btn-sm" onClick={logout}>
                  {t("auth.logout")}
                </button>
              </div>
            </div>
          </header>
          <Outlet />
        </div>
      )}
    </PinGate>
  );
}
