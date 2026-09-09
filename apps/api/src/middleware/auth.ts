// Auth plumbing from @rawtoh/module-sdk, bound to this module's session shape.
import type { RawtohAuthEnv, RawtohSessionData } from "@rawtoh/module-sdk/hono";
import { createAuthMiddleware } from "@rawtoh/module-sdk/hono";

export { hubAuthHeaders } from "@rawtoh/module-sdk/hono";

export type SessionData = RawtohSessionData & {};
export type AuthEnv = RawtohAuthEnv<SessionData>;

export const { requireAuth, resolveOrg } = createAuthMiddleware<SessionData>();
