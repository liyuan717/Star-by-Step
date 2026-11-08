import {
  Runtime,
  State,
  Item,
  Table,
  DATA_TABLES,
  RULES,
  canonical,
  localDate,
  shiftDate,
  metrics,
  definitions,
  buildings,
  achievements,
  catalog,
  MAX_TOTAL,
} from "./model";
import {
  SCHEMA,
  PAGE_ORDER,
  Sql,
  load,
  save,
  isTable,
  payloadField,
  readRows,
  rowFilters,
} from "./sql";
import { validateState, requireValid, checkImage } from "./validate";
import { categories, errors, levelFor, periodKey } from "../domain";
export class LocalError extends Error {
  constructor(public code: string) {
    super(errors[code] || code);
  }
}
function fail(code: string): never {
  throw new LocalError(code);
}
const int = (x: unknown, min: number, max: number) => {
  const n = Number(x);
  if (!Number.isInteger(n) || n < min || n > max) fail("VALIDATION_ERROR");
  return n;
};
export class LocalEngine {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private sql: Sql,
    public env: Runtime,
  ) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn);
    this.queue = p.catch(() => {});
    return p;
  }
  async init() {
    await this.sql.execAsync(
      "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
    );
    const v = await this.sql.getAllAsync<{ user_version: number }>(
      "PRAGMA user_version",
    );
    if (v[0].user_version > 1) throw Error("本地数据由更新版本创建，请升级App");
    await this.sql.execAsync(SCHEMA);
    const check = await this.sql.getAllAsync<any>("PRAGMA quick_check");
    requireValid(
      Object.values(check[0])[0] === "ok",
      "本地数据库校验失败，请从备份恢复",
    );
  }
  private async transaction<T>(fn: (s: State) => Promise<T> | T) {
    await this.sql.execAsync("BEGIN IMMEDIATE");
    try {
      const before = await load(this.sql),
        s = JSON.parse(JSON.stringify(before)) as State;
      const result = await fn(s);
      validateState(s);
      await save(this.sql, before, s);
      await this.sql.execAsync("COMMIT");
      return result;
    } catch (e) {
      try {
        await this.sql.execAsync("ROLLBACK");
        if (e instanceof Error) Object.assign(e, { rolledBack: true });
      } catch {}
      throw e;
    }
  }
  pending() {
    return this.serial(async () => {
      const rows = await this.sql.getAllAsync<{ payload: string }>(
        "SELECT payload FROM pending_operations WHERE id=1",
      );
      return rows[0] ? JSON.parse(rows[0].payload) : null;
    });
  }
  stageIntent(value: Item) {
    return this.serial(async () => {
      await this.sql.runAsync(
        "INSERT INTO pending_operations(id,payload) VALUES(1,?)",
        JSON.stringify(value),
      );
    });
  }
  clearIntent(id: string) {
    return this.serial(async () => {
      await this.sql.runAsync(
        "DELETE FROM pending_operations WHERE id=1 AND json_extract(payload,'$.id')=?",
        id,
      );
    });
  }
  snapshot() {
    return this.serial(() => load(this.sql));
  }
  async rows(table: string): Promise<Item[]> {
    if (definitions[table]) return definitions[table];
    if (!isTable(table)) throw Error("本地数据表不存在");
    return this.serial(() => readRows(this.sql, table));
  }
  async row(table: string, id: string) {
    if (!isTable(table)) throw Error("本地数据表不存在");
    return this.serial(async () => {
      const rows = await readRows(this.sql, table, "WHERE id = ?", [id]);
      return rows[0] ?? null;
    });
  }
  page(
    table: keyof typeof PAGE_ORDER,
    where: Record<string, string>,
    limit: number,
    before?: { time: string; id: string },
  ) {
    const order = payloadField(PAGE_ORDER[table]);
    const { clauses, values } = rowFilters(where);
    if (before) {
      clauses.push(`(${order}, id) < (?, ?)`);
      values.push(before.time, before.id);
    }
    const filter = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    return this.serial(() =>
      readRows(
        this.sql,
        table,
        `${filter} ORDER BY ${order} DESC, id DESC LIMIT ?`,
        [...values, limit],
      ),
    );
  }
  async count(table: string, where: Record<string, string>) {
    if (!isTable(table)) throw Error("本地数据表不存在");
    const { clauses, values } = rowFilters(where);
    const filter = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    return this.serial(async () => {
      const [result] = await this.sql.getAllAsync<{ total: number }>(
        `SELECT COUNT(*) AS total FROM "${table}" ${filter}`,
        ...values,
      );
      return result.total;
    });
  }
  replace(state: State) {
    return this.serial(() =>
      this.transaction(async (s) => {
        const next = validateState(state);
        for (const t of DATA_TABLES) s[t] = next[t];
        await this.sql.execAsync("DELETE FROM pending_operations");
      }),
    );
  }
  write(op: string, p: Item = {}, rid = this.env.id()): Promise<Item> {
    return this.serial(() =>
      this.transaction(async (s) => {
        const prior = s.requests.find((r) => r.id === rid);
        if (prior) {
          if (
            prior.operation !== op ||
            canonical(prior.payload) !==
              canonical(op === "save_media" ? { id: p.id } : p)
          )
            fail("IDEMPOTENCY_CONFLICT");
          return prior.result;
        }
        const now = this.env.now(),
          ts = now.toISOString();
        let profile = s.profiles[0];
        if (op !== "finish_onboarding" && !profile) fail("VALIDATION_ERROR");
        if (
          s.meta[0] &&
          Date.parse(s.meta[0].last_write_at) > now.getTime() + 120000
        )
          throw Error("设备时间早于上次记录，请校准手机时间后重试");
        let uid = profile?.user_id,
          date = localDate(now, profile?.timezone || "UTC");
        const base = () => ({
          id: this.env.id(),
          user_id: uid,
          created_at: ts,
          updated_at: ts,
          version: 1,
        });
        const named = () => {
          const title = String(p.title ?? "").trim(),
            description = String(p.description ?? "");
          if (!title || title.length > 80 || description.length > 2000)
            fail("VALIDATION_ERROR");
          const category = p.category ?? "other";
          if (!categories.includes(category)) fail("VALIDATION_ERROR");
          return { title, description, category };
        };
        const find = (t: Table, id: unknown, expected?: unknown) => {
          const r = s[t].find((x) => x.id === id);
          if (!r) fail("NOT_FOUND_OR_FORBIDDEN");
          if (expected !== undefined && r.version !== expected)
            fail("VERSION_CONFLICT");
          return r;
        };
        const touch = (r: Item) => {
          r.version++;
          r.updated_at = ts;
        };
        const event = (key: string, kind: string, payload: Item = {}) => {
          if (!s.timeline_events.some((e) => e.event_key === key))
            s.timeline_events.push({
              id: this.env.id(),
              user_id: uid,
              event_key: key,
              kind,
              payload,
              created_at: ts,
            });
        };
        const growth = () => {
          const m = metrics(s, date),
            world = s.user_worlds[0],
            old = world.world_level;
          world.world_level = levelFor(world.total_world_xp);
          for (let l = old + 1; l <= world.world_level; l++)
            event("level:" + l, "level_up", { level: l });
          const nb: Item[] = [],
            na: string[] = [];
          for (const b of buildings) {
            if (
              b.min_xp > world.total_world_xp ||
              b.min_study_minutes > m.study_minutes ||
              b.min_life_count > m.life_count ||
              b.min_exercise_count > m.exercise_count
            )
              continue;
            let existing = s.world_buildings.find(
              (x) => x.building_key === b.building_key,
            );
            if ((existing?.level || 0) >= b.level) continue;
            if (existing) {
              existing.level = b.level;
              existing.upgraded_at = ts;
            } else {
              s.world_buildings.push(
                (existing = {
                  id: this.env.id(),
                  user_id: uid,
                  building_key: b.building_key,
                  level: b.level,
                  unlocked_at: ts,
                  upgraded_at: ts,
                }),
              );
            }
            event(`building:${b.building_key}:${b.level}`, "building_level", {
              building_key: b.building_key,
              level: b.level,
            });
            nb.push({ key: b.building_key, level: b.level });
          }
          for (const a of achievements) {
            const n = (
              {
                count: m.completion_count,
                study: m.study_minutes,
                streak: m.longest_streak,
                redemptions: s.redemptions.length,
              } as Record<string, number>
            )[String(a.metric_key)];
            if (
              n >= Number(a.threshold) &&
              !s.user_achievements.some((x) => x.achievement_key === a.key)
            ) {
              s.user_achievements.push({
                user_id: uid,
                achievement_key: a.key,
                unlocked_at: ts,
              });
              event("achievement:" + a.key, "achievement", { title: a.title });
              na.push(String(a.key));
            }
          }
          return { new_buildings: nb, new_achievements: na };
        };
        const ledger = (amount: number, type: string, id: string) => {
          const w = s.wallets[0];
          w.energy_balance += amount;
          if (amount > 0) w.lifetime_earned += amount;
          else w.lifetime_spent -= amount;
          s.energy_transactions.push({
            id: this.env.id(),
            user_id: uid,
            amount,
            type,
            completion_id: type === "task" ? id : null,
            redemption_id: type === "redemption" ? id : null,
            balance_after: w.energy_balance,
            created_at: ts,
            sequence: s.energy_transactions.length + 1,
          });
        };
        let result: Item = {};
        if (op === "finish_onboarding") {
          if (!profile) {
            const nickname = String(p.nickname ?? "").trim();
            if (!nickname || nickname.length > 40) fail("VALIDATION_ERROR");
            try {
              date = localDate(now, p.timezone);
            } catch {
              fail("VALIDATION_ERROR");
            }
            uid = this.env.id();
            profile = {
              user_id: uid,
              nickname,
              timezone: p.timezone,
              focus_category: p.focus_category || "other",
              avatar_path: null,
              onboarded_at: ts,
              deletion_requested_at: null,
              version: 1,
              created_at: ts,
              updated_at: ts,
            };
            s.profiles.push(profile);
            s.wallets.push({
              user_id: uid,
              energy_balance: 0,
              lifetime_earned: 0,
              lifetime_spent: 0,
            });
            s.user_worlds.push({
              user_id: uid,
              world_name: "起源星",
              planet_key: "origin",
              total_world_xp: 0,
              world_level: 1,
            });
            s.meta.push({
              id: "local",
              world_id: uid,
              last_write_at: ts,
              schema_version: 1,
            });
            s.world_buildings.push({
              id: this.env.id(),
              user_id: uid,
              building_key: "base",
              level: 1,
              unlocked_at: ts,
              upgraded_at: ts,
            });
            event("world_created", "world_created");
            if (p.create_starter)
              s.tasks.push({
                ...base(),
                title: "写下第一个行动",
                description: "",
                category: "life",
                goal_id: null,
                difficulty: "normal",
                energy_reward: 10,
                recurrence: "once",
                start_date: date,
                end_date: null,
                due_date: null,
                estimated_minutes: null,
                status: "active",
                system_key: "starter",
              });
          }
          result = { user_id: profile.user_id };
        } else if (
          op === "upsert_goal" ||
          op === "upsert_task" ||
          op === "upsert_real_reward"
        ) {
          const table =
            op === "upsert_goal"
              ? "goals"
              : op === "upsert_task"
                ? "tasks"
                : "rewards";
          const old = p.id ? find(table, p.id, p.expected_version) : null;
          if (old && ["archived", "completed"].includes(old.status))
            fail(table === "goals" ? "GOAL_INACTIVE" : "TASK_INACTIVE");
          const r: Item = { ...(old || base()), ...named() };
          if (table === "goals") {
            r.target_count = int(p.target_count ?? 10, 1, 10000);
            r.deadline = p.deadline || null;
            r.is_primary = p.is_primary === true;
            if (r.is_primary)
              for (const g of s.goals)
                if (g.id !== r.id && g.is_primary) {
                  g.is_primary = false;
                  touch(g);
                }
          } else if (table === "tasks") {
            r.goal_id = p.goal_id || null;
            if (
              r.goal_id &&
              !s.goals.some((g) => g.id === r.goal_id && g.status === "active")
            )
              fail("GOAL_INACTIVE");
            r.energy_reward = int(p.energy_reward, 1, 300);
            r.recurrence = p.recurrence || "once";
            if (old && r.recurrence !== old.recurrence)
              fail("VALIDATION_ERROR");
            r.start_date = p.start_date || date;
            r.end_date = p.end_date || null;
            r.due_date = p.due_date || null;
            r.estimated_minutes = p.estimated_minutes
              ? int(p.estimated_minutes, 1, 480)
              : null;
            r.difficulty = p.difficulty || "normal";
            r.system_key = old?.system_key || null;
          } else {
            r.energy_cost = int(p.energy_cost, 1, 1000000);
            r.image_path = p.image_path || null;
          }
          r.status = old?.status || "active";
          if (table === "goals") r.completed_at = old?.completed_at || null;
          if (old) {
            touch(r);
            Object.assign(old, r);
          } else s[table].push(r);
          result = { id: r.id };
        } else if (
          op === "set_task_status" ||
          op === "set_goal_status" ||
          op === "archive_reward"
        ) {
          const table =
              op === "set_task_status"
                ? "tasks"
                : op === "set_goal_status"
                  ? "goals"
                  : "rewards",
            r = find(table, p.id, p.expected_version),
            st = op === "archive_reward" ? "archived" : p.next_status;
          const allowed =
            r.status === "active"
              ? [
                  "paused",
                  "archived",
                  ...(table === "goals" ? ["completed"] : []),
                ]
              : r.status === "paused"
                ? ["active", "archived"]
                : r.status === "completed" && table === "goals"
                  ? ["archived"]
                  : [];
          if (!allowed.includes(st))
            fail(table === "tasks" ? "TASK_INACTIVE" : "GOAL_INACTIVE");
          r.status = st;
          if (st === "completed") r.completed_at = ts;
          touch(r);
          result = { id: r.id, status: st };
        } else if (op === "complete_task") {
          if (p.confirmed_local_date && p.confirmed_local_date !== date)
            fail("PERIOD_CHANGED");
          const t = find("tasks", p.task_id, p.expected_task_version);
          if (t.status !== "active") fail("TASK_INACTIVE");
          const goal = t.goal_id
            ? s.goals.find((g) => g.id === t.goal_id)
            : null;
          if (t.goal_id && goal?.status !== "active") fail("GOAL_INACTIVE");
          if (date < t.start_date || (t.end_date && date > t.end_date))
            fail("OUTSIDE_ACTIVE_DATES");
          const minutes = int(p.actual_minutes, 0, 480),
            pk = periodKey(t.recurrence, date);
          if (
            s.task_completions.some(
              (c) => c.task_id === t.id && c.period_key === pk,
            )
          )
            fail("ALREADY_COMPLETED");
          const today = s.task_completions.filter((c) => c.local_date === date);
          if (
            today.length >= 100 ||
            today.reduce((a, c) => a + c.energy_awarded, 0) + t.energy_reward >
              3000
          )
            fail("DAILY_LIMIT_REACHED");
          if (s.wallets[0].lifetime_earned + t.energy_reward > MAX_TOTAL)
            fail("VALUE_LIMIT_REACHED");
          const id = this.env.id();
          s.task_completions.push({
            id,
            user_id: uid,
            task_id: t.id,
            period_key: pk,
            completed_at: ts,
            local_date: date,
            timezone_snapshot: profile.timezone,
            task_title_snapshot: t.title,
            category_snapshot: t.category,
            goal_id_snapshot: t.goal_id,
            goal_title_snapshot: goal?.title || null,
            energy_awarded: t.energy_reward,
            xp_awarded: t.energy_reward,
            actual_minutes: minutes,
            task_version: t.version,
            rule_version: 1,
          });
          ledger(t.energy_reward, "task", id);
          s.user_worlds[0].total_world_xp += t.energy_reward;
          const g = growth();
          event("task:" + id, "task_completed", {
            title: t.title,
            energy: t.energy_reward,
          });
          result = {
            completion_id: id,
            period_key: pk,
            energy_awarded: t.energy_reward,
            xp_awarded: t.energy_reward,
            balance_after: s.wallets[0].energy_balance,
            total_world_xp: s.user_worlds[0].total_world_xp,
            world_level: s.user_worlds[0].world_level,
            ...g,
          };
        } else if (op === "redeem_reward") {
          if (Boolean(p.real_reward_id) === Boolean(p.virtual_key))
            fail("VALIDATION_ERROR");
          const r = p.real_reward_id
            ? find("rewards", p.real_reward_id)
            : catalog.find((c) => c.key === p.virtual_key);
          if (!r || r.status === "archived") fail("NOT_FOUND_OR_FORBIDDEN");
          if (
            p.virtual_key &&
            s.user_inventory.some((i) => i.virtual_key === p.virtual_key)
          )
            fail("ALREADY_OWNED");
          if (
            r.version !== p.expected_source_version ||
            r.energy_cost !== p.expected_cost
          )
            fail("PRICE_CHANGED");
          if (s.wallets[0].energy_balance < r.energy_cost)
            fail("INSUFFICIENT_ENERGY");
          const id = this.env.id();
          s.redemptions.push({
            id,
            user_id: uid,
            real_reward_id: p.real_reward_id || null,
            virtual_key: p.virtual_key || null,
            title_snapshot: r.title,
            description_snapshot: r.description,
            image_path_snapshot: r.image_path || null,
            energy_spent: r.energy_cost,
            source_version: r.version,
            status: p.virtual_key ? "delivered" : "redeemed",
            redeemed_at: ts,
            local_date: date,
            enjoyed_at: null,
          });
          ledger(-r.energy_cost, "redemption", id);
          if (p.virtual_key)
            s.user_inventory.push({
              user_id: uid,
              virtual_key: p.virtual_key,
              slot: r.slot,
              acquired_redemption_id: id,
              equipped: false,
              acquired_at: ts,
            });
          event("redemption:" + id, "redemption", {
            title: r.title,
            energy: r.energy_cost,
          });
          result = {
            redemption_id: id,
            balance_after: s.wallets[0].energy_balance,
            ...growth(),
          };
        } else if (op === "mark_reward_enjoyed") {
          const r = find("redemptions", p.redemption_id);
          if (!r.real_reward_id) fail("VALIDATION_ERROR");
          r.status = "enjoyed";
          r.enjoyed_at = r.enjoyed_at || ts;
          result = { id: r.id, status: r.status };
        } else if (op === "equip_decoration") {
          const r = s.user_inventory.find(
            (i) => i.virtual_key === p.virtual_key,
          );
          if (!r) fail("NOT_OWNED");
          if (typeof p.equipped !== "boolean") fail("VALIDATION_ERROR");
          if (p.equipped)
            for (const i of s.user_inventory)
              if (i.slot === r.slot) i.equipped = false;
          r.equipped = p.equipped;
          result = { virtual_key: r.virtual_key };
        } else if (op === "update_profile") {
          if (p.expected_version !== profile.version) fail("VERSION_CONFLICT");
          if ("nickname" in p) profile.nickname = String(p.nickname).trim();
          if ("avatar_path" in p) profile.avatar_path = p.avatar_path;
          if ("world_name" in p)
            s.user_worlds[0].world_name = String(p.world_name).trim();
          touch(profile);
          result = { user_id: uid };
        } else if (op === "sync_world") result = growth();
        else if (op === "save_media") {
          const m = {
            id: p.id,
            mime: p.mime,
            base64: p.base64,
            sha256: p.sha256,
          };
          const imageSize = checkImage(m);
          requireValid(
            s.media.some((x) => x.id === m.id) ||
              s.media.reduce((n, x) => n + checkImage(x), 0) + imageSize <=
                32 * 1024 * 1024,
            "本机图片总量上限32MB，请选择更小图片",
          );
          requireValid(
            (await this.env.hash(m.base64)) === m.sha256 &&
              m.id ===
                `media/${m.sha256}.${m.mime === "image/jpeg" ? "jpg" : m.mime === "image/png" ? "png" : "webp"}`,
          );
          if (!s.media.some((x) => x.id === m.id)) s.media.push(m);
          result = { id: m.id };
        } else fail("VALIDATION_ERROR");
        s.meta[0].last_write_at = ts;
        // Image content is already stored in media; don't duplicate its base64 in the request journal.
        const journalPayload = op === "save_media" ? { id: p.id } : p;
        s.requests.push({
          id: rid,
          operation: op,
          payload: journalPayload,
          result,
          created_at: ts,
        });
        return result;
      }),
    );
  }
  async read(op: string, args: Item = {}): Promise<any> {
    return this.serial(async () => {
      if (op === "reconcile") {
        const s = await load(this.sql);
        validateState(s);
        return {
          ok: true,
          ledger_count: s.energy_transactions.length,
          energy: s.wallets[0]?.energy_balance || 0,
          xp: s.user_worlds[0]?.total_world_xp || 0,
        };
      }
      const [profile = null] = await readRows(this.sql, "profiles");
      const now = this.env.now();
      const date = localDate(now, profile?.timezone || "UTC");
      if (op === "get_home_context") {
        const s = await load(this.sql, [
          "tasks",
          "goals",
          "wallets",
          "user_worlds",
          "rewards",
        ]);
        const completions = await this.sql.getAllAsync<{
          task_id: string;
          period_key: string;
        }>(
          `SELECT ${payloadField("task_id")} AS task_id,
                  ${payloadField("period_key")} AS period_key
             FROM task_completions
            WHERE ${payloadField("period_key")} IN (?, ?, ?)`,
          "once",
          periodKey("daily", date),
          periodKey("weekly", date),
        );
        const completed = new Set(
          completions.map((c) => `${c.task_id}:${c.period_key}`),
        );
        const activeGoals = new Set(
          s.goals.filter((g) => g.status === "active").map((g) => g.id),
        );
        const today = await readRows(
          this.sql,
          "task_completions",
          `WHERE ${payloadField("local_date")} = ?`,
          [date],
        );
        const pending = s.tasks
          .filter(
            (t) =>
              t.status === "active" &&
              t.start_date <= date &&
              (!t.end_date || t.end_date >= date) &&
              (!t.goal_id || activeGoals.has(t.goal_id)) &&
              !completed.has(`${t.id}:${periodKey(t.recurrence, date)}`),
          )
          .sort((a, b) =>
            (a.due_date || "9999-12-31").localeCompare(
              b.due_date || "9999-12-31",
            ),
          )
          .map((t) => ({
            ...t,
            overdue:
              t.recurrence === "once" && !!t.due_date && t.due_date < date,
          }));
        const balance = s.wallets[0]?.energy_balance || 0;
        return {
          device_now: now.toISOString(),
          today: date,
          timezone: profile?.timezone,
          profile,
          wallet: s.wallets[0] || null,
          world: s.user_worlds[0] || null,
          usage: {
            completion_count: today.length,
            energy_earned: today.reduce((a, c) => a + c.energy_awarded, 0),
          },
          rules: RULES,
          pending,
          next_reward:
            s.rewards
              .filter((r) => r.status === "active")
              .sort(
                (a, b) =>
                  Math.max(a.energy_cost - balance, 0) -
                    Math.max(b.energy_cost - balance, 0) ||
                  a.energy_cost - b.energy_cost ||
                  a.created_at.localeCompare(b.created_at) ||
                  a.id.localeCompare(b.id),
              )[0] || null,
        };
      }
      if (op === "get_growth_metrics")
        return metrics(await load(this.sql, ["task_completions"]), date);
      if (op === "get_statistics") {
        const n = int(args.p_days, 7, 30);
        if (![7, 30].includes(n)) fail("VALIDATION_ERROR");
        const range = `WHERE ${payloadField("local_date")} BETWEEN ? AND ?`;
        const bounds = [shiftDate(date, 1 - n), date];
        const completions = await readRows(
          this.sql,
          "task_completions",
          range,
          bounds,
        );
        const redemptions = await readRows(
          this.sql,
          "redemptions",
          range,
          bounds,
        );
        return Array.from({ length: n }, (_, i) => {
          const d = shiftDate(date, i - n + 1),
            c = completions.filter((x) => x.local_date === d);
          return {
            date: d,
            completions: c.length,
            earned: c.reduce((a, x) => a + x.energy_awarded, 0),
            spent: redemptions
              .filter((x) => x.local_date === d)
              .reduce((a, x) => a + x.energy_spent, 0),
            study_minutes: c
              .filter((x) => x.category_snapshot === "study")
              .reduce((a, x) => a + x.actual_minutes, 0),
          };
        });
      }
      throw Error("不支持的本地查询");
    });
  }
}
