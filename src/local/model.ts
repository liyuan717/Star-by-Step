import { z } from "zod";
import { categories, thresholds } from "../domain";

export const DATA_TABLES = [
  "profiles",
  "goals",
  "tasks",
  "wallets",
  "user_worlds",
  "task_completions",
  "rewards",
  "redemptions",
  "energy_transactions",
  "world_buildings",
  "user_inventory",
  "user_achievements",
  "timeline_events",
  "media",
  "requests",
  "meta",
] as const;
export type Table = (typeof DATA_TABLES)[number];
export type Item = Record<string, any>;
export type State = Record<Table, Item[]>;
export interface Runtime {
  id(): string;
  now(): Date;
  hash(text: string): Promise<string>;
}
export const MAX_TOTAL = 9_000_000_000_000;
export const RULES = {
  version: 1,
  max_task_energy: 300,
  max_daily_count: 100,
  max_daily_energy: 3000,
  safe_total: MAX_TOTAL,
};
export const buildings = Object.entries({
  base: [0, 300, 1500],
  energy_hub: [100, 700, 3000],
  research_lab: [300, 1500, 5500],
  greenhouse: [700, 3000, 9000],
  training_pod: [1500, 5500, 14000],
}).flatMap(([key, levels]) =>
  levels.map((xp, i) => ({
    building_key: key,
    level: i + 1,
    min_xp: xp,
    min_study_minutes: key === "research_lab" ? [300, 600, 1800][i] : 0,
    min_life_count: key === "greenhouse" ? [10, 30, 60][i] : 0,
    min_exercise_count: key === "training_pod" ? [10, 30, 60][i] : 0,
    asset_key: `${key}_${i + 1}`,
  })),
);
export const catalog: Item[] = [
  ["beacon", "星光信标", "为起源星点亮一束蓝光", 100],
  ["garden", "月光花园", "安静生长的月光植物", 200],
  ["sky", "极光天幕", "横跨殖民地的柔和极光", 300],
].map(([key, title, description, cost]) => ({
  key,
  title,
  description,
  energy_cost: cost,
  slot: key,
  asset_key: key,
  active: true,
  version: 1,
}));
export const achievements = [
  ["first_task", "首次完成", "完成第一次行动", "count", 1],
  ["ten_tasks", "持续行动", "累计完成十次", "count", 10],
  ["scholar", "知识探索者", "累计学习300分钟", "study", 300],
  ["seven_days", "七日同行", "连续七个本地日行动", "streak", 7],
  ["first_reward", "首次兑换", "兑换一份奖励", "redemptions", 1],
].map(([key, title, description, metric, threshold]) => ({
  key,
  title,
  description,
  metric_key: metric,
  threshold,
  asset_key: key,
  active: true,
}));
export const definitions: Record<string, Item[]> = {
  building_levels: buildings,
  virtual_catalog: catalog,
  achievements,
  world_levels: thresholds.map((min_xp, i) => ({
    level: i + 1,
    min_xp,
    version: 1,
  })),
};
export function emptyState(): State {
  return Object.fromEntries(
    DATA_TABLES.map((t) => [t, []]),
  ) as unknown as State;
}
export function rowKey(t: Table, r: Item): string {
  if (t === "user_inventory") return r.virtual_key;
  if (t === "user_achievements") return r.achievement_key;
  return String(r.id ?? r.user_id);
}
export function canonical(x: any): string {
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (x && typeof x === "object")
    return (
      "{" +
      Object.keys(x)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(x);
}
export function localDate(date: Date, zone: string): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const v = (t: string) => p.find((x) => x.type === t)!.value;
  return `${v("year")}-${v("month")}-${v("day")}`;
}
export function shiftDate(d: string, n: number) {
  const dt = new Date(d + "T12:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
export function validDate(x: unknown): x is string {
  return (
    typeof x === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(x) &&
    !Number.isNaN(Date.parse(x + "T12:00:00Z")) &&
    new Date(x + "T12:00:00Z").toISOString().slice(0, 10) === x
  );
}
export function metrics(s: State, today: string) {
  const c = s.task_completions;
  let longest = 0,
    current = 0,
    run = 0,
    last = "";
  for (const d of [...new Set(c.map((x) => x.local_date))].sort()) {
    run = last && shiftDate(last, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    if (d === today || d === shiftDate(today, -1)) current = run;
    last = d;
  }
  return {
    completion_count: c.length,
    study_minutes: c
      .filter((x) => x.category_snapshot === "study")
      .reduce((a, x) => a + x.actual_minutes, 0),
    life_count: c.filter((x) => x.category_snapshot === "life").length,
    exercise_count: c.filter((x) => x.category_snapshot === "exercise").length,
    longest_streak: longest,
    current_streak: current,
  };
}

const uuid = z.uuid(),
  text = z.string(),
  stamp = z.iso.datetime({ offset: true }),
  date = text.refine(validDate),
  n = z.number().int().min(0).max(MAX_TOTAL),
  cat = z.enum(categories);
const owned = { user_id: uuid },
  entity = { ...owned, id: uuid },
  version = { version: z.number().int().min(1) },
  named = { title: text.trim().min(1).max(80), description: text.max(2000) },
  times = { created_at: stamp, updated_at: stamp },
  image = text.regex(/^media\/[0-9a-f]{64}\.(jpg|png|webp)$/).nullable();
export const schemas: Record<Table, z.ZodType> = {
  profiles: z.object({
    ...owned,
    nickname: text.trim().min(1).max(40),
    timezone: text.refine((x) => {
      try {
        localDate(new Date(), x);
        return true;
      } catch {
        return false;
      }
    }),
    focus_category: cat,
    avatar_path: image,
    onboarded_at: stamp,
    deletion_requested_at: z.null(),
    ...version,
    ...times,
  }),
  goals: z.object({
    ...entity,
    ...named,
    category: cat,
    target_count: z.number().int().min(1).max(10000),
    deadline: date.nullable(),
    is_primary: z.boolean(),
    status: z.enum(["active", "paused", "completed", "archived"]),
    completed_at: stamp.nullable(),
    ...version,
    ...times,
  }),
  tasks: z.object({
    ...entity,
    ...named,
    category: cat,
    goal_id: uuid.nullable(),
    difficulty: z.enum([
      "micro",
      "easy",
      "normal",
      "medium",
      "hard",
      "milestone",
      "ultimate",
    ]),
    energy_reward: z.number().int().min(1).max(300),
    recurrence: z.enum(["once", "daily", "weekly"]),
    start_date: date,
    end_date: date.nullable(),
    due_date: date.nullable(),
    estimated_minutes: z.number().int().min(1).max(480).nullable(),
    status: z.enum(["active", "paused", "archived"]),
    system_key: text.nullable(),
    ...version,
    ...times,
  }),
  wallets: z.object({
    ...owned,
    energy_balance: n,
    lifetime_earned: n,
    lifetime_spent: n,
  }),
  user_worlds: z.object({
    ...owned,
    world_name: text.trim().min(1).max(40),
    planet_key: z.literal("origin"),
    total_world_xp: n,
    world_level: z.number().int().min(1).max(10),
  }),
  task_completions: z.object({
    ...entity,
    task_id: uuid,
    period_key: text,
    completed_at: stamp,
    local_date: date,
    timezone_snapshot: text,
    task_title_snapshot: text.min(1).max(80),
    category_snapshot: cat,
    goal_id_snapshot: uuid.nullable(),
    goal_title_snapshot: text.nullable(),
    energy_awarded: z.number().int().min(1).max(300),
    xp_awarded: z.number().int().min(1).max(300),
    actual_minutes: z.number().int().min(0).max(480),
    task_version: z.number().int().min(1),
    rule_version: z.literal(1),
  }),
  rewards: z.object({
    ...entity,
    ...named,
    image_path: image,
    energy_cost: z.number().int().min(1).max(1000000),
    status: z.enum(["active", "archived"]),
    ...version,
    ...times,
  }),
  redemptions: z.object({
    ...entity,
    real_reward_id: uuid.nullable(),
    virtual_key: z.enum(["beacon", "garden", "sky"]).nullable(),
    title_snapshot: text.min(1).max(80),
    description_snapshot: text.max(2000),
    image_path_snapshot: image,
    energy_spent: z.number().int().min(1).max(1000000),
    source_version: z.number().int().min(1),
    status: z.enum(["redeemed", "enjoyed", "delivered"]),
    redeemed_at: stamp,
    local_date: date,
    enjoyed_at: stamp.nullable(),
  }),
  energy_transactions: z.object({
    ...entity,
    amount: z
      .number()
      .int()
      .min(-MAX_TOTAL)
      .max(MAX_TOTAL)
      .refine((x) => x !== 0),
    type: z.enum(["task", "redemption"]),
    completion_id: uuid.nullable(),
    redemption_id: uuid.nullable(),
    balance_after: n,
    created_at: stamp,
    sequence: z.number().int().min(1),
  }),
  world_buildings: z.object({
    ...entity,
    building_key: z.enum([
      "base",
      "energy_hub",
      "research_lab",
      "greenhouse",
      "training_pod",
    ]),
    level: z.number().int().min(1).max(3),
    unlocked_at: stamp,
    upgraded_at: stamp,
  }),
  user_inventory: z.object({
    ...owned,
    virtual_key: z.enum(["beacon", "garden", "sky"]),
    slot: z.enum(["beacon", "garden", "sky"]),
    acquired_redemption_id: uuid,
    equipped: z.boolean(),
    acquired_at: stamp,
  }),
  user_achievements: z.object({
    ...owned,
    achievement_key: z.enum([
      "first_task",
      "ten_tasks",
      "scholar",
      "seven_days",
      "first_reward",
    ]),
    unlocked_at: stamp,
  }),
  timeline_events: z.object({
    ...entity,
    event_key: text.min(1).max(150),
    kind: z.enum([
      "world_created",
      "task_completed",
      "level_up",
      "building_level",
      "achievement",
      "redemption",
    ]),
    payload: z.record(text, z.unknown()),
    created_at: stamp,
  }),
  media: z.object({
    id: text.regex(/^media\/[0-9a-f]{64}\.(jpg|png|webp)$/),
    mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
    base64: text.max(2796204),
    sha256: text.regex(/^[0-9a-f]{64}$/),
  }),
  requests: z.object({
    id: uuid,
    operation: text.min(1).max(50),
    payload: z.record(text, z.unknown()),
    result: z.record(text, z.unknown()),
    created_at: stamp,
  }),
  meta: z.object({
    id: z.literal("local"),
    world_id: uuid,
    last_write_at: stamp,
    schema_version: z.literal(1),
  }),
};
