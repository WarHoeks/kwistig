import { useTranslation } from "react-i18next";

export function IssueList({
  message,
  issues,
  onClose,
}: {
  message: string;
  issues: { path: string; message: string }[];
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-100">
      <div className="flex items-start gap-2">
        <p className="font-semibold">{message}</p>
        {onClose && (
          <button type="button" className="ml-auto text-sm text-red-200 underline" onClick={onClose}>
            {t("common.close")}
          </button>
        )}
      </div>
      {issues.length > 0 && (
        <ul className="mt-2 space-y-1 font-mono text-sm">
          {issues.map((i, n) => (
            <li key={n}>
              <span className="text-red-300">{i.path}</span>: {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
