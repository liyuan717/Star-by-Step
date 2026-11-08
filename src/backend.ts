import * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";
import { LocalEngine, LocalError } from "./local/engine";
import { Runtime } from "./local/model";
import { isPagedTable, PAGE_ORDER } from "./local/sql";
export const runtime: Runtime = {
  id: () => Crypto.randomUUID(),
  now: () => new Date(),
  hash: (text) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
};
let opening: Promise<LocalEngine> | undefined;
export function localStore() {
  return (opening ??= (async () => {
    const sql = await SQLite.openDatabaseAsync("energy-world-offline.db");
    const store = new LocalEngine(sql, runtime);
    await store.init();
    return store;
  })().catch((e) => {
    opening = undefined;
    throw e;
  }));
}
export type Pending = {
  id: string;
  op: string;
  payload: Record<string, unknown>;
};
export async function getPending(): Promise<Pending | null> {
  return (await localStore()).pending();
}
export async function write(
  op: string,
  payload: Record<string, unknown> = {},
  replay?: Pending,
) {
  const store = await localStore();
  const existing = await store.pending();
  if (existing && !replay) throw new LocalError("NETWORK_UNKNOWN");
  const request = replay || { id: runtime.id(), op, payload };
  if (!replay) await store.stageIntent(request);
  try {
    const result = await store.write(request.op, request.payload, request.id);
    await store.clearIntent(request.id);
    return result;
  } catch (e) {
    if (
      e instanceof Error &&
      (e as Error & { rolledBack?: boolean }).rolledBack
    )
      await store.clearIntent(request.id);
    throw e;
  }
}
export async function recover(request: Pending) {
  return write(request.op, request.payload, request);
}
export async function readRpc(
  name: string,
  args: Record<string, unknown> = {},
) {
  return (await localStore()).read(name, args);
}
export interface ListOptions {
  where?: Record<string, string>;
  order?: string;
  limit?: number;
  before?: { time: string; id: string };
}
export async function listRows(
  table: string,
  { where = {}, order = "created_at", limit = 30, before }: ListOptions = {},
) {
  const store = await localStore();
  if (isPagedTable(table) && order === PAGE_ORDER[table])
    return store.page(table, where, limit, before);
  let rows = await store.rows(table);
  rows = rows.filter((r) =>
    Object.entries(where).every(([k, v]) => r[k] === v),
  );
  rows.sort(
    (a, b) =>
      String(b[order] || "").localeCompare(String(a[order] || "")) ||
      String(b.id || b.key || "").localeCompare(String(a.id || a.key || "")),
  );
  if (before)
    rows = rows.filter(
      (r) =>
        r[order] < before.time ||
        (r[order] === before.time && r.id < before.id),
    );
  return rows.slice(0, limit);
}
export async function getRow(table: string, id: string) {
  return (await localStore()).row(table, id);
}
export async function countRows(table: string, where: Record<string, string>) {
  return (await localStore()).count(table, where);
}
