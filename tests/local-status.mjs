import fs from "node:fs";
import path from "node:path";
export function localStatus() {
  const candidates = [
    process.env.LOCAL_SUPABASE_STATUS_FILE,
    path.resolve(".tmp/supabase-local.json"),
    path.resolve("../.toolchains/supabase-start.json"),
  ].filter(Boolean);
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file)
    throw Error(
      "请将本地 supabase status --output-format json 保存到 .tmp/supabase-local.json",
    );
  const bytes = fs.readFileSync(file);
  let status;
  try {
    status = JSON.parse(
      bytes
        .toString(bytes[0] === 255 && bytes[1] === 254 ? "utf16le" : "utf8")
        .replace(/^\ufeff/, ""),
    );
  } catch {
    throw Error(
      "本地服务状态文件格式无效；请重新保存UTF-8状态文件（不输出文件正文）。",
    );
  }
  const env = status.env || status;
  const url = process.env.LOCAL_API_URL || env.API_URL;
  if (
    !url ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
  )
    throw Error("集成写入仅允许本地 Supabase");
  if (!env.SERVICE_ROLE_KEY) throw Error("本地服务端测试凭据缺失");
  return {
    url,
    publicKey: env.PUBLISHABLE_KEY || env.ANON_KEY,
    serviceKey: env.SERVICE_ROLE_KEY,
  };
}
