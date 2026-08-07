import { Hono } from "hono";
import {
  getOIDCConfig,
  buildAuthorizeUrl,
  exchangeCode,
  fetchUserInfo,
} from "../auth";
import type { AuthEnv } from "../middleware/auth";

const APP_URL = process.env.APP_URL || "/";

const auth = new Hono<AuthEnv>();

auth.get("/api/auth/login", async (c) => {
  const session = c.get("session");
  const config = await getOIDCConfig();
  const { url, auth: authRequest } = await buildAuthorizeUrl(config);
  await session.update((prev) => ({ ...prev!, auth: authRequest }));
  return c.json({ url: url.toString() });
});

auth.get("/callback", async (c) => {
  const session = c.get("session");
  const error = c.req.query("error");

  if (error) {
    return c.redirect(`${APP_URL}?error=${encodeURIComponent(error)}`);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.redirect(`${APP_URL}?error=missing_params`);
  }

  const data = await session.get();
  const savedAuth = data?.auth;

  if (!savedAuth) {
    return c.redirect(`${APP_URL}?error=invalid_state`);
  }

  try {
    const config = await getOIDCConfig();
    const redirectUri = process.env.RAWTOH_REDIRECT_URI || "http://localhost:10700/callback";
    const callbackUrl = new URL(redirectUri);
    callbackUrl.search = new URL(c.req.url).search;
    const { tokens, sub } = await exchangeCode(config, callbackUrl, {
      expectedState: savedAuth.state,
      expectedNonce: savedAuth.nonce,
      pkceCodeVerifier: savedAuth.codeVerifier,
    });

    const user = await fetchUserInfo(config, tokens.access_token, sub);
    const token_expires_at = Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 3600);
    await session.update({ tokens, user, sub, token_expires_at });
    return c.redirect(APP_URL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[auth] Token exchange error:", msg);
    return c.redirect(`${APP_URL}?error=token_exchange`);
  }
});

auth.get("/api/auth/me", async (c) => {
  const session = c.get("session");
  const data = await session.get();
  if (!data?.user) {
    return c.json({ user: null });
  }
  return c.json({ user: data.user });
});

auth.post("/api/auth/logout", async (c) => {
  const session = c.get("session");
  session.delete();
  return c.json({ ok: true });
});

export default auth;
