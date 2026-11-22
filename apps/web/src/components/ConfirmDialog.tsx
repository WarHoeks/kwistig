import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * In-app confirmation dialog. The browser's own confirm() is unreliable: some
 * browsers (embedded ones, some in-app browsers) skip it and return "no" at once,
 * which silently turned buttons like "Quiz beëindigen" into no-ops.
 */

interface ConfirmOptions {
  /** Text of the confirm button; defaults to "Doorgaan". */
  confirmLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
}

type Ask = (message: string, opts?: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<Ask>(async () => false);

/** Ask the user to confirm; resolves true when they confirm. */
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<{ message: string; opts: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const ask: Ask = useCallback(
    (message, opts = {}) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          prev?.resolve(false); // a newer question replaces an open one
          return { message, opts, resolve };
        });
      }),
    [],
  );

  const answer = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  useEffect(() => {
    if (!pending) return;
    // Focus the safe choice; Escape cancels.
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") answer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, answer]);

  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-4 sm:items-center"
          onClick={(e) => e.target === e.currentTarget && answer(false)}
        >
          <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-message" className="card w-full max-w-sm space-y-5 p-5 shadow-2xl">
            <p id="confirm-message" className="text-lg leading-snug">
              {pending.message}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button ref={cancelRef} type="button" className="btn-ghost py-3" onClick={() => answer(false)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={`btn py-3 ${pending.opts.danger ? "bg-red-500 text-white hover:bg-red-400" : "bg-gold-400 text-ink-950 hover:bg-gold-300"}`}
                onClick={() => answer(true)}
                data-testid="confirm-ok"
              >
                {pending.opts.confirmLabel ?? t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}
