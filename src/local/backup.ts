import { Runtime, State, canonical, DATA_TABLES } from "./model";
import { validateState, checkImage, requireValid } from "./validate";
export const MAX_BACKUP_BYTES = 96 * 1024 * 1024;
export interface Backup {
  format: "ENERGY_WORLD_OFFLINE";
  schemaVersion: 1;
  backupId: string;
  createdAt: string;
  checksum: string;
  payload: { tables: State };
}
export async function makeBackup(state: State, env: Runtime): Promise<Backup> {
  const tables = validateState(state);
  requireValid(tables.profiles.length === 1, "请先创建世界");
  const payload = { tables };
  await verifyMedia(tables, env);
  const b: Backup = {
    format: "ENERGY_WORLD_OFFLINE",
    schemaVersion: 1,
    backupId: env.id(),
    createdAt: env.now().toISOString(),
    checksum: await env.hash(canonical(payload)),
    payload,
  };
  requireValid(
    JSON.stringify(b).length <= MAX_BACKUP_BYTES,
    "备份文件超过96MB上限",
  );
  return b;
}
async function verifyMedia(s: State, env: Runtime) {
  let total = 0;
  for (const m of s.media) {
    total += checkImage(m);
    requireValid(total <= 32 * 1024 * 1024, "图片总量超过32MB上限");
    requireValid((await env.hash(m.base64)) === m.sha256, "图片校验失败");
    requireValid(
      m.id ===
        `media/${m.sha256}.${m.mime === "image/jpeg" ? "jpg" : m.mime === "image/png" ? "png" : "webp"}`,
      "图片标识无效",
    );
  }
}
export async function parseBackup(text: string, env: Runtime): Promise<Backup> {
  requireValid(text.length <= MAX_BACKUP_BYTES, "备份文件超过96MB上限");
  let input: any;
  try {
    input = JSON.parse(text);
  } catch {
    throw Error("备份不是有效的JSON文件");
  }
  requireValid(
    input?.format === "ENERGY_WORLD_OFFLINE" && input.schemaVersion === 1,
    "不支持的备份格式或版本",
  );
  requireValid(
    typeof input.backupId === "string" &&
      /^[0-9a-f-]{36}$/.test(input.backupId) &&
      typeof input.createdAt === "string" &&
      Number.isFinite(Date.parse(input.createdAt)) &&
      typeof input.checksum === "string" &&
      /^[0-9a-f]{64}$/.test(input.checksum),
    "备份文件头无效",
  );
  requireValid(
    input.payload && Object.keys(input.payload).length === 1,
    "备份内容无效",
  );
  requireValid(
    (await env.hash(canonical(input.payload))) === input.checksum,
    "备份校验和不匹配，文件可能已损坏",
  );
  const tables = validateState(input.payload.tables);
  requireValid(tables.profiles.length === 1, "备份中没有完整世界");
  await verifyMedia(tables, env);
  return { ...input, payload: { tables } };
}
export function summary(b: Backup) {
  const s = b.payload.tables;
  return {
    nickname: s.profiles[0].nickname,
    world: s.user_worlds[0].world_name,
    energy: s.wallets[0].energy_balance,
    xp: s.user_worlds[0].total_world_xp,
    tasks: s.tasks.length,
    goals: s.goals.length,
    images: s.media.length,
    records: DATA_TABLES.reduce((n, t) => n + s[t].length, 0),
    createdAt: b.createdAt,
  };
}
