import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { account } from "./schema";
import type { Account, AccountInsert } from "./schema";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://rawtoh:rawtoh@localhost:10702/obs";

const client = new SQL(DATABASE_URL);
export const db = drizzle(client, { schema });

export type { Account, AccountInsert };

export type { RawtohIdentity } from "../rawtoh-auth";
import type { RawtohIdentity } from "../rawtoh-auth";
import { decryptPrivateKey, encryptPrivateKey } from "../identity-crypto";

// ── OBS Accounts ──

/**
 * `private_key` is stored encrypted, so every path that hands a row to the rest
 * of the app decrypts it here. Callers keep seeing plaintext.
 */
async function decryptRow(row: Account): Promise<Account> {
  if (!row.privateKey || !row.instanceId) return row;
  return { ...row, privateKey: await decryptPrivateKey(row.privateKey, row.orgId, row.instanceId) };
}

export async function listAccounts(orgId: string): Promise<Account[]> {
  const rows = await db.select().from(account).where(eq(account.orgId, orgId));
  return Promise.all(rows.map(decryptRow));
}

export async function getAccount(accountId: string): Promise<Account | null> {
  const [row] = await db.select().from(account).where(eq(account.id, accountId));
  return row ? decryptRow(row) : null;
}

export async function createAccount(values: AccountInsert): Promise<void> {
  const privateKey =
    values.privateKey && values.instanceId
      ? await encryptPrivateKey(values.privateKey, values.orgId, values.instanceId)
      : values.privateKey;
  await db.insert(account).values({ ...values, privateKey });
}

export async function updateAccount(
  accountId: string,
  patch: Partial<Pick<Account, "name" | "host" | "port" | "password">>,
): Promise<void> {
  await db.update(account).set(patch).where(eq(account.id, accountId));
}

export async function setAccountIdentity(accountId: string, identity: RawtohIdentity): Promise<void> {
  const [row] = await db.select({ orgId: account.orgId }).from(account).where(eq(account.id, accountId));
  if (!row) return;
  await db
    .update(account)
    .set({
      instanceId: identity.instanceId,
      privateKey: await encryptPrivateKey(identity.privateKey, row.orgId, identity.instanceId),
    })
    .where(eq(account.id, accountId));
}

export async function deleteAccountIdentity(accountId: string): Promise<void> {
  await db
    .update(account)
    .set({ instanceId: null, privateKey: null })
    .where(eq(account.id, accountId));
}

export async function deleteAccount(accountId: string): Promise<void> {
  await db.delete(account).where(eq(account.id, accountId));
}

export async function listAllAccounts(): Promise<Account[]> {
  const rows = await db.select().from(account);
  return Promise.all(rows.map(decryptRow));
}
