// One-time desktop migration only. This module is never imported by the mobile app.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { localStatus } from "../tests/local-status.mjs";
import { LEGACY_TABLES, migrateLegacy } from "../src/local/legacy";
import { parseBackup } from "../src/local/backup";
const args = process.argv.slice(2),
  index = args.indexOf("--user-id"),
  output = args.indexOf("--output");
if (
  index < 0 ||
  output < 0 ||
  !/^([0-9a-f]{8}-){1}[0-9a-f-]{27}$/.test(args[index + 1] || "")
)
  throw Error(
    "用法：node --import tsx scripts/migrate-legacy.ts --user-id 用户UUID --output outputs/旧世界.energyworld.json",
  );
const uid = args[index + 1],
  dest = path.resolve(args[output + 1]);
if (fs.existsSync(dest))
  throw Error("输出文件已存在，请选择新文件名，避免覆盖备份");
process.env.LOCAL_API_URL =
  process.env.LOCAL_API_URL || "http://127.0.0.1:55321";
const { url, serviceKey } = localStatus();
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const tables: Record<string, any[]> = {};
for (const t of LEGACY_TABLES) {
  tables[t] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await fetch(
      `${url}/rest/v1/${t}?user_id=eq.${uid}&order=${["profiles", "wallets", "user_worlds"].includes(t) ? "user_id" : t === "user_inventory" ? "virtual_key" : t === "user_achievements" ? "achievement_key" : "id"}&limit=500&offset=${offset}`,
      { headers },
    );
    if (!r.ok) throw Error(`读取旧表失败：${t}，HTTP${r.status}`);
    const data = await r.json();
    tables[t].push(...data);
    if (data.length < 500) break;
  }
}
if (tables.profiles.length !== 1)
  throw Error("指定用户没有可迁移的完整世界；未生成文件，也未更改旧服务");
const refs = [
  tables.profiles[0].avatar_path,
  ...tables.rewards.map((r) => r.image_path),
  ...tables.redemptions.map((r) => r.image_path_snapshot),
].filter(Boolean);
const images: Record<string, { mime: string; base64: string }> = {};
for (const key of new Set(refs)) {
  if (!key.startsWith(uid + "/") || key.includes(".."))
    throw Error("旧图片路径不合法");
  const r = await fetch(
    `${url}/storage/v1/object/user-media/${key.split("/").map(encodeURIComponent).join("/")}`,
    { headers },
  );
  if (!r.ok) throw Error("无法完整读取旧图片，迁移取消");
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > 2097152) throw Error("旧图片超过2MB，迁移取消");
  images[key] = {
    mime: (r.headers.get("content-type") || "").split(";")[0],
    base64: bytes.toString("base64"),
  };
}
const env = {
  id: randomUUID,
  now: () => new Date(),
  hash: async (text: string) => createHash("sha256").update(text).digest("hex"),
};
const backup = await migrateLegacy(tables, images, env),
  text = JSON.stringify(backup);
await parseBackup(text, env);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, text, { flag: "wx" });
console.log(
  "PASS 已生成并校验完整离线迁移备份（包含图片）；旧服务只读，未删除或修改任何旧数据。",
);
console.log(dest);
