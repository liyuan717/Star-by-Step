import {
  DATA_TABLES,
  State,
  Item,
  schemas,
  rowKey,
  emptyState,
  metrics,
  buildings,
  achievements,
  catalog,
  localDate,
  MAX_TOTAL,
} from "./model";
import { levelFor, periodKey } from "../domain";
export function requireValid(
  ok: unknown,
  message = "备份数据不完整或不一致",
): asserts ok {
  if (!ok) throw Error(message);
}
function unique(rows: Item[], key: (r: Item) => unknown) {
  const k = rows.map(key);
  requireValid(new Set(k).size === k.length);
}
export function validateState(value: unknown): State {
  requireValid(value && typeof value === "object" && !Array.isArray(value));
  const input = value as Record<string, unknown>;
  requireValid(Object.keys(input).length === DATA_TABLES.length);
  const s = emptyState();
  let count = 0;
  for (const t of DATA_TABLES) {
    requireValid(Array.isArray(input[t]));
    const rows = input[t] as unknown[];
    count += rows.length;
    requireValid(count <= 50000, "记录数量超过本地备份上限50000条");
    s[t] = rows.map((r) => {
      const v = schemas[t].safeParse(r);
      requireValid(v.success, `数据格式错误：${t}`);
      return v.data as Item;
    });
    unique(s[t], (r) => rowKey(t, r));
  }
  if (!s.profiles.length) {
    requireValid(DATA_TABLES.every((t) => s[t].length === 0));
    return s;
  }
  requireValid(
    s.profiles.length === 1 &&
      s.wallets.length === 1 &&
      s.user_worlds.length === 1 &&
      s.meta.length === 1,
  );
  const p = s.profiles[0],
    w = s.wallets[0],
    world = s.user_worlds[0];
  requireValid(s.meta[0].world_id === p.user_id);
  for (const t of DATA_TABLES)
    for (const r of s[t])
      if ("user_id" in r) requireValid(r.user_id === p.user_id);
  const tasks = new Map(s.tasks.map((r) => [r.id, r])),
    goals = new Map(s.goals.map((r) => [r.id, r])),
    rewards = new Map(s.rewards.map((r) => [r.id, r])),
    completions = new Map(s.task_completions.map((r) => [r.id, r])),
    redemptions = new Map(s.redemptions.map((r) => [r.id, r]));
  requireValid(
    s.goals.filter((r) => r.is_primary && r.status !== "archived").length <= 1,
  );
  for (const t of s.tasks) {
    requireValid(!t.goal_id || goals.has(t.goal_id));
    requireValid(!t.end_date || t.end_date >= t.start_date);
    requireValid(
      !t.due_date || (t.recurrence === "once" && t.due_date >= t.start_date),
    );
  }
  unique(s.task_completions, (r) => `${r.task_id}:${r.period_key}`);
  const daily = new Map<string, { n: number; e: number }>();
  let earned = 0,
    spent = 0;
  for (const c of s.task_completions) {
    const t = tasks.get(c.task_id);
    requireValid(t);
    requireValid(
      c.energy_awarded === c.xp_awarded &&
        c.timezone_snapshot === p.timezone &&
        localDate(new Date(c.completed_at), p.timezone) === c.local_date &&
        c.period_key === periodKey(t.recurrence, c.local_date),
    );
    requireValid(!c.goal_id_snapshot || goals.has(c.goal_id_snapshot));
    earned += c.energy_awarded;
    const d = daily.get(c.local_date) || { n: 0, e: 0 };
    d.n++;
    d.e += c.energy_awarded;
    requireValid(d.n <= 100 && d.e <= 3000);
    daily.set(c.local_date, d);
  }
  for (const r of s.redemptions) {
    requireValid(Boolean(r.real_reward_id) !== Boolean(r.virtual_key));
    if (r.real_reward_id)
      requireValid(
        rewards.has(r.real_reward_id) &&
          ["redeemed", "enjoyed"].includes(r.status),
      );
    else
      requireValid(
        catalog.some((c) => c.key === r.virtual_key) &&
          r.status === "delivered" &&
          !r.image_path_snapshot,
      );
    requireValid((r.status === "enjoyed") === Boolean(r.enjoyed_at));
    requireValid(
      localDate(new Date(r.redeemed_at), p.timezone) === r.local_date,
    );
    spent += r.energy_spent;
  }
  unique(
    s.redemptions.filter((r) => r.virtual_key),
    (r) => r.virtual_key,
  );
  const ledger = [...s.energy_transactions].sort(
    (a, b) => a.sequence - b.sequence,
  );
  let balance = 0;
  const usedC = new Set(),
    usedR = new Set();
  for (const [i, l] of ledger.entries()) {
    requireValid(l.sequence === i + 1);
    balance += l.amount;
    requireValid(
      Number.isSafeInteger(balance) &&
        balance >= 0 &&
        balance <= MAX_TOTAL &&
        l.balance_after === balance,
    );
    if (l.type === "task") {
      const c = completions.get(l.completion_id);
      requireValid(
        c &&
          !l.redemption_id &&
          !usedC.has(c.id) &&
          l.amount === c.energy_awarded &&
          l.created_at === c.completed_at,
      );
      usedC.add(c.id);
    } else {
      const r = redemptions.get(l.redemption_id);
      requireValid(
        r &&
          !l.completion_id &&
          !usedR.has(r.id) &&
          l.amount === -r.energy_spent &&
          l.created_at === r.redeemed_at,
      );
      usedR.add(r.id);
    }
  }
  requireValid(
    usedC.size === completions.size &&
      usedR.size === redemptions.size &&
      w.energy_balance === balance &&
      w.lifetime_earned === earned &&
      w.lifetime_spent === spent &&
      earned - spent === balance &&
      earned <= MAX_TOTAL &&
      world.total_world_xp === earned &&
      world.world_level === levelFor(earned),
    "积分流水或世界成长对账失败",
  );
  const m = metrics(s, localDate(new Date(p.updated_at), p.timezone)),
    eligible = new Map<string, number>();
  for (const b of buildings)
    if (
      b.min_xp <= earned &&
      b.min_study_minutes <= m.study_minutes &&
      b.min_life_count <= m.life_count &&
      b.min_exercise_count <= m.exercise_count
    )
      eligible.set(b.building_key, b.level);
  unique(s.world_buildings, (r) => r.building_key);
  requireValid(s.world_buildings.length === eligible.size);
  for (const b of s.world_buildings)
    requireValid(eligible.get(b.building_key) === b.level);
  const expectedAchievements = achievements
    .filter(
      (a) =>
        Number(a.threshold) <=
        (
          {
            count: m.completion_count,
            study: m.study_minutes,
            streak: m.longest_streak,
            redemptions: s.redemptions.length,
          } as Record<string, number>
        )[String(a.metric_key)],
    )
    .map((a) => a.key);
  requireValid(
    expectedAchievements.length === s.user_achievements.length &&
      s.user_achievements.every((a) =>
        expectedAchievements.includes(a.achievement_key),
      ),
  );
  const virtual = s.redemptions.filter((r) => r.virtual_key);
  requireValid(virtual.length === s.user_inventory.length);
  unique(
    s.user_inventory.filter((r) => r.equipped),
    (r) => r.slot,
  );
  for (const i of s.user_inventory) {
    const r = redemptions.get(i.acquired_redemption_id);
    requireValid(
      r &&
        r.virtual_key === i.virtual_key &&
        i.slot === catalog.find((c) => c.key === i.virtual_key)?.slot,
    );
  }
  unique(s.timeline_events, (r) => r.event_key);
  const events = new Set(s.timeline_events.map((r) => r.event_key));
  requireValid(events.has("world_created"));
  for (const c of s.task_completions) requireValid(events.has("task:" + c.id));
  for (const r of s.redemptions) requireValid(events.has("redemption:" + r.id));
  const media = new Set(s.media.map((r) => r.id));
  for (const path of [
    p.avatar_path,
    ...s.rewards.map((r) => r.image_path),
    ...s.redemptions.map((r) => r.image_path_snapshot),
  ].filter(Boolean))
    requireValid(media.has(path), "备份缺少引用的图片");
  return s;
}
export function checkImage(m: Item) {
  const b = m.base64;
  requireValid(
    typeof b === "string" &&
      b.length > 0 &&
      b.length <= 2796204 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        b,
      ),
    "图片编码无效或超过2MB",
  );
  const size =
    (b.length / 4) * 3 - (b.endsWith("==") ? 2 : b.endsWith("=") ? 1 : 0);
  requireValid(size <= 2097152);
  const ok =
    m.mime === "image/jpeg"
      ? b.startsWith("/9j/")
      : m.mime === "image/png"
        ? b.startsWith("iVBORw0KGgo")
        : m.mime === "image/webp"
          ? b.startsWith("UklGR")
          : false;
  requireValid(ok, "图片内容与格式不匹配");
  return size;
}
