import type { z } from "zod";

/** `["rounds", 0, "items", 2, "options"]` → `rounds[0].items[2].options` */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out === "" ? String(seg) : `.${String(seg)}`;
  }
  return out === "" ? "(root)" : out;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Flattens a ZodError into readable issues such as
 * `rounds[0].items[2].options: needs 2 to 6 entries`.
 * Union failures are unwrapped to the branch that matched the discriminator, so
 * the user sees the real problem, not "invalid input".
 */
export function formatIssues(error: z.ZodError): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const walk = (issues: readonly z.core.$ZodIssue[], prefix: readonly PropertyKey[]) => {
    for (const issue of issues) {
      const path = [...prefix, ...issue.path];
      if (issue.code === "invalid_union" && issue.errors.length > 0) {
        // Plain-string-or-object unions (LocalizedText): report the simpler branch.
        const best = issue.errors.reduce((a, b) => (b.length < a.length ? b : a));
        walk(best, path);
        continue;
      }
      out.push({ path: formatPath(path), message: describe(issue) });
    }
  };
  walk(error.issues, []);
  return out;
}

function describe(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case "unrecognized_keys":
      return `unknown field${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => `"${k}"`).join(", ")}`;
    case "invalid_value":
      return `must be one of ${issue.values.map((v) => JSON.stringify(v)).join(", ")}`;
    case "invalid_type":
      return issue.message.startsWith("Invalid input")
        ? `expected ${issue.expected}`
        : issue.message;
    default:
      return issue.message;
  }
}

export function issuesToString(issues: ValidationIssue[]): string {
  return issues.map((i) => `${i.path}: ${i.message}`).join("\n");
}
