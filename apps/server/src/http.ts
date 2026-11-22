import type { FastifyReply } from "fastify";
import { formatIssues, type ApiError } from "@kwistig/shared";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly issues?: ApiError["issues"],
  ) {
    super(message);
  }
}

/** Validates any payload with Zod; throws a 400 with readable paths on failure. */
export function parse<T extends z.ZodType>(schema: T, data: unknown, what = "validation_failed"): z.infer<T> {
  const res = schema.safeParse(data);
  if (!res.success) throw new HttpError(400, what, formatIssues(res.error));
  return res.data;
}

export function sendError(reply: FastifyReply, err: HttpError) {
  const body: ApiError = { error: err.message, ...(err.issues ? { issues: err.issues } : {}) };
  return reply.status(err.statusCode).send(body);
}
