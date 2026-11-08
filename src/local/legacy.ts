import { State, Runtime, emptyState } from "./model";
import { validateState, requireValid, checkImage } from "./validate";
import { makeBackup } from "./backup";
export const LEGACY_TABLES = [
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
] as const;
export async function migrateLegacy(
  rows: Record<string, any[]>,
  images: Record<string, { mime: string; base64: string }>,
  env: Runtime,
) {
  const s = emptyState();
  for (const t of LEGACY_TABLES) {
    requireValid(Array.isArray(rows[t]), `旧数据缺少${t}`);
    s[t] = structuredClone(rows[t]);
  }
  requireValid(s.profiles.length === 1, "迁移一次只接受一个完整世界");
  const owner = s.profiles[0].user_id;
  for (const t of LEGACY_TABLES)
    requireValid(
      s[t].every((r) => r.user_id === owner),
      "旧数据存在不同用户，不能合并",
    );
  const paths = [
    s.profiles[0].avatar_path,
    ...s.rewards.map((r) => r.image_path),
    ...s.redemptions.map((r) => r.image_path_snapshot),
  ].filter(Boolean);
  const mapping = new Map<string, string>();
  for (const old of new Set(paths)) {
    const image = images[old];
    requireValid(image, `旧图片缺失，迁移已取消：${old}`);
    const sha256 = await env.hash(image.base64),
      id = `media/${sha256}.${image.mime === "image/jpeg" ? "jpg" : image.mime === "image/png" ? "png" : "webp"}`,
      m = { id, ...image, sha256 };
    checkImage(m);
    mapping.set(old, id);
    if (!s.media.some((x) => x.id === id)) s.media.push(m);
  }
  s.profiles[0].avatar_path = mapping.get(s.profiles[0].avatar_path) || null;
  for (const r of s.rewards) r.image_path = mapping.get(r.image_path) || null;
  for (const r of s.redemptions)
    r.image_path_snapshot = mapping.get(r.image_path_snapshot) || null;
  // PostgreSQL timestamps have microseconds. Preserve chronological order before assigning SQLite sequence numbers.
  s.energy_transactions.sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  s.energy_transactions.forEach((r, i) => (r.sequence = i + 1));
  s.meta = [
    {
      id: "local",
      world_id: owner,
      last_write_at: env.now().toISOString(),
      schema_version: 1,
    },
  ];
  s.requests = [];
  const checked = validateState(s as State);
  return makeBackup(checked, env);
}
