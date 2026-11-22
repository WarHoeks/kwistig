import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Language, LocalizedText } from "@kwistig/shared";

const other = (lang: Language): Language => (lang === "nl" ? "en" : "nl");

export function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Edits a LocalizedText. A plain string stays a plain string until a translation is
 * added; removing or emptying the translation collapses it back to a string, so
 * untouched imports keep their exact shape.
 */
export function LocalizedInput({
  label,
  value,
  quizLang,
  onChange,
  multiline = false,
  rows = 3,
}: {
  label: string;
  value: LocalizedText | undefined;
  quizLang: Language;
  onChange: (v: LocalizedText | undefined) => void;
  multiline?: boolean;
  rows?: number;
}) {
  const { t } = useTranslation();
  const id = useId();
  const second = other(quizLang);
  const primary = typeof value === "string" ? value : (value?.[quizLang] ?? "");
  const translation = typeof value === "object" ? value[second] : undefined;
  const hasTranslation = typeof value === "object" && second in value;

  const emit = (p: string, tr: string | undefined) => {
    if (tr === undefined) {
      onChange(p === "" ? undefined : p);
      return;
    }
    const obj: { nl?: string; en?: string } = {};
    if (p !== "") obj[quizLang] = p;
    obj[second] = tr;
    onChange(obj);
  };

  const Input = multiline ? "textarea" : "input";
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <label htmlFor={id} className="label mb-0">
          {label}
        </label>
        {!hasTranslation && (
          <button
            type="button"
            className="ml-auto text-xs font-semibold text-ink-400 hover:text-gold-300"
            onClick={() => emit(primary, "")}
          >
            {t("editor.addTranslation", { lang: second.toUpperCase() })}
          </button>
        )}
      </div>
      <Input
        id={id}
        className="field"
        rows={multiline ? rows : undefined}
        value={primary}
        onChange={(e) => emit(e.target.value, hasTranslation ? (translation ?? "") : undefined)}
      />
      {hasTranslation && (
        <div className="mt-2 flex items-start gap-2 pl-4">
          <span className="mt-2 rounded bg-ink-700 px-1.5 text-xs font-bold uppercase text-ink-200">{second}</span>
          <Input
            aria-label={t("editor.translation", { lang: second.toUpperCase() })}
            className="field"
            rows={multiline ? rows : undefined}
            value={translation ?? ""}
            onChange={(e) => emit(primary, e.target.value)}
          />
          <button
            type="button"
            className="btn-danger btn-sm mt-1"
            aria-label={t("editor.removeTranslation")}
            title={t("editor.removeTranslation")}
            onClick={() => emit(primary, undefined)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/** Number input where empty means "not set". */
export function OptionalNumber({
  label,
  value,
  onChange,
  placeholder,
  min,
  step,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  min?: number;
  step?: number | "any";
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        type="number"
        className="field"
        inputMode="decimal"
        min={min}
        step={step}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      />
    </Field>
  );
}

export function OptionalText({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  multiline?: boolean;
}) {
  const id = useId();
  const Input = multiline ? "textarea" : "input";
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        className="field"
        rows={multiline ? 3 : undefined}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      />
    </Field>
  );
}

/** Sets or deletes an optional key, keeping the object free of `undefined` values. */
export function setOpt<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined): void {
  if (value === undefined) delete obj[key];
  else obj[key] = value;
}
