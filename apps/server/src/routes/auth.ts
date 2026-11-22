import type { FastifyInstance, FastifyRequest } from "fastify";
import { LoginBody, type AuthStatus } from "@kwistig/shared";
import { AttemptLimiter } from "../auth/pin.js";
import { HttpError, parse } from "../http.js";

/** preHandler for host-only routes. */
export function requireHost(app: FastifyInstance) {
  return async (req: FastifyRequest) => {
    if (!app.auth.isHost(req)) throw new HttpError(401, "pin_required");
  };
}

export async function authRoutes(app: FastifyInstance) {
  const limiter = new AttemptLimiter();

  app.get("/status", async (req): Promise<AuthStatus> => ({ authenticated: app.auth.isHost(req) }));

  app.post("/login", async (req, reply) => {
    if (!limiter.allow(req.ip)) throw new HttpError(429, "too_many_attempts");
    const { pin } = parse(LoginBody, req.body);
    if (!app.auth.verify(pin)) throw new HttpError(401, "wrong_pin");
    app.auth.signIn(reply);
    return { authenticated: true } satisfies AuthStatus;
  });

  app.post("/logout", async (_req, reply) => {
    app.auth.signOut(reply);
    return { authenticated: false } satisfies AuthStatus;
  });
}
