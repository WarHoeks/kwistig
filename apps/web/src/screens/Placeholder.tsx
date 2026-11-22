import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function Placeholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  const { code } = useParams();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="font-display text-5xl text-gold-400">{t("app.name")}</p>
      <h1 className="text-2xl font-bold">{t(titleKey, { code })}</h1>
      <p className="text-ink-400">{t("common.comingSoon")}</p>
    </main>
  );
}
