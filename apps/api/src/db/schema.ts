import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  host: text("host").notNull().default("127.0.0.1"),
  port: integer("port").notNull().default(4455),
  // obs-websocket v5 password (no username in the protocol). Empty = auth
  // disabled on the OBS side. Plaintext, like the OAuth tokens in the other
  // modules — the DB is the secret store here.
  password: text("password").notNull().default(""),
  // Rawtoh module instance this account drives, and the Ed25519 private key it
  // proves ownership of. Generated here at enrollment; the hub only ever sees
  // the public half. Null until the account is enrolled.
  instanceId: text("instance_id"),
  privateKey: text("private_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const session = pgTable("session", {
  sid: text("sid").primaryKey(),
  data: text("data").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type Account = InferSelectModel<typeof account>;
export type AccountInsert = InferInsertModel<typeof account>;
export type Session = InferSelectModel<typeof session>;
