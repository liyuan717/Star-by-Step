import { DATA_TABLES, Item, State, Table, rowKey, emptyState } from "./model";
export interface Sql {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...args: any[]): Promise<any>;
  getAllAsync<T = any>(sql: string, ...args: any[]): Promise<T[]>;
}
export const PAGE_ORDER = {
  tasks: "created_at",
  goals: "created_at",
  rewards: "created_at",
  task_completions: "completed_at",
  redemptions: "redeemed_at",
  energy_transactions: "created_at",
  timeline_events: "created_at",
} as const satisfies Partial<Record<Table, string>>;

export function isPagedTable(table: string): table is keyof typeof PAGE_ORDER {
  return Object.prototype.hasOwnProperty.call(PAGE_ORDER, table);
}

export function payloadField(field: string) {
  if (!/^[a-z_]+$/.test(field)) throw Error("无效的本地查询字段");
  return `json_extract(payload,'$.${field}')`;
}

export function rowFilters(where: Record<string, string>) {
  const entries = Object.entries(where);
  return {
    clauses: entries.map(([field]) => `${payloadField(field)} = ?`),
    values: entries.map(([, value]) => value),
  };
}

export const SCHEMA =
  DATA_TABLES.map(
    (t) =>
      `CREATE TABLE IF NOT EXISTS "${t}" (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)));`,
  ).join("\n") +
  `
CREATE UNIQUE INDEX IF NOT EXISTS completion_period ON task_completions(json_extract(payload,'$.task_id'),json_extract(payload,'$.period_key'));
CREATE UNIQUE INDEX IF NOT EXISTS ledger_completion ON energy_transactions(json_extract(payload,'$.completion_id')) WHERE json_extract(payload,'$.completion_id') IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_redemption ON energy_transactions(json_extract(payload,'$.redemption_id')) WHERE json_extract(payload,'$.redemption_id') IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_sequence ON energy_transactions(json_extract(payload,'$.sequence'));
CREATE UNIQUE INDEX IF NOT EXISTS owned_virtual ON redemptions(json_extract(payload,'$.virtual_key')) WHERE json_extract(payload,'$.virtual_key') IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS building_key ON world_buildings(json_extract(payload,'$.building_key'));
CREATE UNIQUE INDEX IF NOT EXISTS timeline_key ON timeline_events(json_extract(payload,'$.event_key'));
CREATE UNIQUE INDEX IF NOT EXISTS primary_goal ON goals(json_extract(payload,'$.is_primary')) WHERE json_extract(payload,'$.is_primary')=1 AND json_extract(payload,'$.status')!='archived';
CREATE UNIQUE INDEX IF NOT EXISTS equipped_slot ON user_inventory(json_extract(payload,'$.slot')) WHERE json_extract(payload,'$.equipped')=1;
CREATE TABLE IF NOT EXISTS pending_operations(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL CHECK(json_valid(payload)));
CREATE INDEX IF NOT EXISTS completion_local_day ON task_completions(json_extract(payload,'$.local_date'));
CREATE INDEX IF NOT EXISTS redemption_local_day ON redemptions(json_extract(payload,'$.local_date'));
PRAGMA user_version=1;` +
  Object.entries(PAGE_ORDER)
    .map(
      ([table, field]) =>
        `CREATE INDEX IF NOT EXISTS page_${table} ON "${table}"(${payloadField(field)} DESC, id DESC);`,
    )
    .join("\n");

export async function readRows(
  sql: Sql,
  table: Table,
  suffix = "ORDER BY id",
  bindings: (string | number)[] = [],
): Promise<Item[]> {
  const rows = await sql.getAllAsync<{ payload: string }>(
    `SELECT payload FROM "${table}" ${suffix}`,
    ...bindings,
  );
  return rows.map(({ payload }) => JSON.parse(payload));
}

export async function load(
  sql: Sql,
  tables: readonly Table[] = DATA_TABLES,
): Promise<State> {
  const s = emptyState();
  for (const t of tables) s[t] = await readRows(sql, t);
  return s;
}
export async function save(sql: Sql, before: State, after: State) {
  for (const t of DATA_TABLES) {
    const old = new Map(
        before[t].map((r) => [rowKey(t, r), JSON.stringify(r)]),
      ),
      next = new Map(after[t].map((r) => [rowKey(t, r), JSON.stringify(r)]));
    for (const [k, p] of old)
      if (next.get(k) !== p)
        await sql.runAsync(`DELETE FROM "${t}" WHERE id=?`, k);
    for (const [k, p] of next)
      if (old.get(k) !== p)
        await sql.runAsync(`INSERT INTO "${t}"(id,payload) VALUES(?,?)`, k, p);
  }
}
export function isTable(t: string): t is Table {
  return (DATA_TABLES as readonly string[]).includes(t);
}
