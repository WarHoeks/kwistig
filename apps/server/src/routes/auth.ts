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

  app.get("/status", async (req): Promise<AuthStatus> => {
    const authenticated = app.auth.isHost(req);
    return { authenticated, ...(authenticated ? { defaultPin: app.auth.usingDefaultPin() } : {}) };
  });

  app.post("/login", async (req, reply) => {
    const { pin } = parse(LoginBody, req.body);
    const result = await limiter.attempt(req.ip, () => app.auth.verify(pin));
    if (result === "blocked") throw new HttpError(429, "too_many_attempts");
    if (result === "wrong") throw new HttpError(401, "wrong_pin");
    app.auth.signIn(reply);
    return { authenticated: true, defaultPin: app.auth.usingDefaultPin() } satisfies AuthStatus;
  });

  app.post("/logout", async (_req, reply) => {
    app.auth.signOut(reply);
    return { authenticated: false } satisfies AuthStatus;
  });
}
