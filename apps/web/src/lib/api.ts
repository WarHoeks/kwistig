import type { ApiError } from "@kwistig/shared";

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly issues: NonNullable<ApiError["issues"]> = [],
  ) {
    super(code);
  }
}

/** JSON fetch against the Kwistig API. Throws RequestError with the server's error code. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body !== undefined ? { "content-type": "application/json" } : {},
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new RequestError(0, "network");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as unknown;
  if (!res.ok) {
    const err = data as Partial<ApiError>;
    throw new RequestError(res.status, err.error ?? "generic", err.issues);
  }
  return data as T;
}

/** i18n key for an error, falling back to the generic message. */
export function errorKey(err: unknown): string {
  const known = ["network", "wrong_pin", "too_many_attempts", "pin_required", "quiz_not_found", "invalid_quiz", "invalid_json", "session_active"];
  const code = err instanceof RequestError ? err.code : "generic";
  return `errors.${known.includes(code) ? code : "generic"}`;
}
