import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { localStatus } from "./local-status.mjs";
const mode = process.argv[2] || "integration";
const connectionString =
  process.env.LOCAL_DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const parsed = new URL(connectionString);
if (
  mode !== "reconcile" &&
  !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
)
  throw Error("写入测试仅允许本地数据库");
const pool = new pg.Pool({
  connectionString,
  max: 24,
  connectionTimeoutMillis: 15000,
});
const users = [];
let admin;
async function createUser() {
  let id = randomUUID();
  if (process.env.AUTH_SHIM === "1")
    await pool.query(
      "insert into auth.users(id,email,aud,role) values($1,$2,'authenticated','authenticated')",
      [id, `${id}@local.invalid`],
    );
  else {
    if (!admin) {
      const status = localStatus();
      admin = createClient(status.url, status.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    const result = await admin.auth.admin.createUser({
      email: `${id}@local.invalid`,
      password: randomUUID() + "Aa1!",
      email_confirm: true,
    });
    assert.ifError(result.error);
    id = result.data.user.id;
  }
  users.push(id);
  return id;
}
async function rpc(user, op, p = {}, rid = randomUUID()) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    const { rows } = await c.query(`select public.${op}($1,$2) result`, [
      rid,
      p,
    ]);
    await c.query("commit");
    return rows[0].result;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
async function ok(user, op, p = {}, rid) {
  const r = await rpc(user, op, p, rid);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data;
}
async function reconcile() {
  const { rows } =
    await pool.query(`select user_id from public.wallets w where energy_balance<>(select coalesce(sum(amount),0) from public.energy_transactions e where e.user_id=w.user_id) or lifetime_earned<>(select coalesce(sum(amount),0) from public.energy_transactions e where e.user_id=w.user_id and amount>0) or lifetime_spent<>-(select coalesce(sum(amount),0) from public.energy_transactions e where e.user_id=w.user_id and amount<0)
 union select user_id from public.user_worlds w where total_world_xp<>(select coalesce(sum(xp_awarded),0) from public.task_completions c where c.user_id=w.user_id)
 union select user_id from public.task_completions c where not exists(select 1 from public.energy_transactions e where e.completion_id=c.id and e.amount=c.energy_awarded)
 union select user_id from public.redemptions r where not exists(select 1 from public.energy_transactions e where e.redemption_id=r.id and e.amount=-r.energy_spent)
 union select i.user_id from public.user_inventory i left join public.redemptions r on r.id=i.acquired_redemption_id where r.id is null or r.user_id<>i.user_id or r.virtual_key<>i.virtual_key`);
  assert.equal(rows.length, 0, "对账异常（只报告，不自动修改）");
  console.log("PASS 余额、累计收入/支出、XP、正负流水与库存对账");
}
try {
  await pool.query("select 1");
  if (mode === "reconcile") {
    await pool.query("begin read only");
    await reconcile();
    await pool.query("rollback");
  } else {
    const u = await createUser();
    await ok(u, "finish_onboarding", {
      nickname: "并发测试",
      timezone: "Asia/Shanghai",
    });
    const task = await ok(u, "upsert_task", {
      title: "并发行动",
      category: "study",
      recurrence: "once",
      energy_reward: 150,
    });
    const p = {
      task_id: task.id,
      actual_minutes: 30,
      expected_task_version: 1,
    };
    if (mode === "concurrency") {
      const results = await Promise.all(
        Array.from({ length: 20 }, () => rpc(u, "complete_task", p)),
      );
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.equal(
        results.filter((r) => r.code === "ALREADY_COMPLETED").length,
        19,
      );
      console.log("PASS T02 20个独立连接并发只发奖一次");
      const reward = await ok(u, "upsert_real_reward", {
        title: "电影",
        energy_cost: 100,
      });
      const rp = {
        real_reward_id: reward.id,
        expected_source_version: 1,
        expected_cost: 100,
      };
      const redemptions = await Promise.all([
        rpc(u, "redeem_reward", rp),
        rpc(u, "redeem_reward", rp),
      ]);
      assert.equal(redemptions.filter((r) => r.ok).length, 1);
      assert.equal(
        redemptions.filter((r) => r.code === "INSUFFICIENT_ENERGY").length,
        1,
      );
      console.log("PASS T08 并发兑换150余额只成功一次");
      const t2 = await ok(u, "upsert_task", {
        title: "相同请求并发",
        category: "life",
        recurrence: "daily",
        energy_reward: 10,
      });
      const rid = randomUUID(),
        args = { task_id: t2.id, actual_minutes: 0, expected_task_version: 1 };
      const same = await Promise.all(
        Array.from({ length: 20 }, () => rpc(u, "complete_task", args, rid)),
      );
      assert.equal(new Set(same.map((r) => r.data?.completion_id)).size, 1);
      assert.ok(same.every((r) => r.ok));
      console.log("PASS T01 同 UUID 20连接获得同一完成ID");
    } else {
      await ok(u, "complete_task", p);
      const other = await createUser();
      await ok(other, "finish_onboarding", {
        nickname: "隔离账户",
        timezone: "UTC",
      });
      assert.equal(
        (await rpc(other, "complete_task", p)).code,
        "NOT_FOUND_OR_FORBIDDEN",
      );
      console.log("PASS 真实 Postgres RPC 权限与归属检查");
    }
    await reconcile();
  }
} catch (e) {
  console.error("FAIL / BLOCKED:", e.code || e.message);
  process.exitCode = 1;
} finally {
  for (const u of users) {
    if (admin) {
      const result = await admin.auth.admin.deleteUser(u);
      if (result.error) {
        console.error("Local test cleanup failed");
        process.exitCode = 1;
      }
    } else
      await pool.query("delete from auth.users where id=$1", [u]).catch(() => {
        process.exitCode = 1;
      });
  }
  await pool.end();
}
