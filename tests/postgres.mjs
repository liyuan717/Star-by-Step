// Real PostgreSQL processes and independent TCP connections; Auth is a minimal test shim.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { worldFixtures } from "./world-fixtures.mjs";
const dir = path.resolve(".tmp", `postgres-${Date.now()}`);
await mkdir(dir, { recursive: true });
const cluster = new EmbeddedPostgres({
  databaseDir: dir,
  user: "postgres",
  password: "local-test-only",
  port: 55439,
  persistent: true,
  autoRehydrateSymlinks: true,
  onLog: () => {},
  onError: () => {},
});
let started = false;
try {
  await cluster.initialise();
  await cluster.start();
  started = true;
  const connectionString =
    "postgresql://postgres:local-test-only@127.0.0.1:55439/postgres";
  const db = new pg.Client({ connectionString });
  await db.connect();
  await db.query(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,aud text,role text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of (await readdir("supabase/migrations")).sort())
    if (!file.includes("storage"))
      await db.query(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query(await readFile("supabase/seed.sql", "utf8"));
  await worldFixtures(db);
  await db.end();
  for (const mode of ["integration", "concurrency", "reconcile"])
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["tests/live.mjs", mode], {
        stdio: "inherit",
        windowsHide: true,
        env: {
          ...process.env,
          LOCAL_DATABASE_URL: connectionString,
          AUTH_SHIM: "1",
        },
      });
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(Error(`测试失败: ${mode}`)),
      );
    });
  console.log(
    "PASS real PostgreSQL multi-connection suite (Auth shim, not Supabase stack)",
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  if (started) await cluster.stop();
}
