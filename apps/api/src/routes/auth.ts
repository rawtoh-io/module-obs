import { authRoutes } from "@rawtoh/module-sdk/hono";
import type { SessionData } from "../middleware/auth";

const APP_URL = process.env.APP_URL || "http://localhost:10701";

export default authRoutes<SessionData>(APP_URL);
