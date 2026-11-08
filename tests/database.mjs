import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { worldFixtures } from "./world-fixtures.mjs";
const db = new PGlite();
await db.exec(
  `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
);
for (const file of (await readdir("supabase/migrations")).sort())
  if (!file.includes("storage"))
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
await db.exec(await readFile("supabase/seed.sql", "utf8"));
const u = randomUUID(),
  v = randomUUID();
await db.query("insert into auth.users values($1),($2)", [u, v]);
async function as(user) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
}
async function rpc(op, p = {}, rid = randomUUID()) {
  const r = await db.query(`select public.${op}($1::uuid,$2::jsonb) result`, [
    rid,
    JSON.stringify(p),
  ]);
  return r.rows[0].result;
}
async function ok(op, p = {}, rid) {
  const r = await rpc(op, p, rid);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data;
}
async function scalar(sql) {
  return Object.values((await db.query(sql)).rows[0])[0];
}
async function run(name, fn) {
  await fn();
  console.log("PASS", name);
}
await as(u);
await ok("finish_onboarding", {
  nickname: "开发者",
  timezone: "Asia/Shanghai",
  focus_category: "study",
  create_starter: true,
});
await run("T20 重复引导无赠币、单基地新手任务", async () => {
  await ok("finish_onboarding", {
    nickname: "开发者",
    timezone: "America/New_York",
    create_starter: true,
  });
  assert.equal(await scalar("select energy_balance from public.wallets"), 0);
  assert.equal(await scalar("select count(*)::int from public.tasks"), 1);
  assert.equal(
    await scalar("select timezone from public.profiles"),
    "Asia/Shanghai",
  );
});
let t = await ok("upsert_task", {
  title: "研究",
  category: "study",
  energy_reward: 150,
  recurrence: "once",
});
let rid = randomUUID(),
  p = { task_id: t.id, expected_task_version: 1, actual_minutes: 300 };
let first;
await run("T01 同 UUID 20 次仅一次发奖", async () => {
  first = await ok("complete_task", p, rid);
  for (let i = 0; i < 20; i++)
    assert.deepEqual(await ok("complete_task", p, rid), first);
  assert.equal(
    await scalar("select count(*)::int from public.task_completions"),
    1,
  );
  assert.equal(await scalar("select energy_balance from public.wallets"), 150);
});
await run("T02 不同 UUID 同周期拒绝（串行验证）", async () => {
  for (let i = 0; i < 20; i++)
    assert.equal((await rpc("complete_task", p)).code, "ALREADY_COMPLETED");
});
await run("T03 跨操作重用 UUID 拒绝", async () => {
  assert.equal((await rpc("sync_world", {}, rid)).code, "IDEMPOTENCY_CONFLICT");
});
let reward = await ok("upsert_real_reward", {
  title: "电影之夜",
  energy_cost: 100,
});
const rp = {
  real_reward_id: reward.id,
  expected_cost: 100,
  expected_source_version: 1,
};
const rrid = randomUUID();
await run("T08/T09 兑换重放、余额不足、XP 保留（串行）", async () => {
  const a = await ok("redeem_reward", rp, rrid);
  assert.deepEqual(await ok("redeem_reward", rp, rrid), a);
  assert.equal((await rpc("redeem_reward", rp)).code, "INSUFFICIENT_ENERGY");
  assert.equal(await scalar("select energy_balance from public.wallets"), 50);
  assert.equal(
    await scalar("select total_world_xp from public.user_worlds"),
    150,
  );
});
await run("T10 价格版本保护", async () => {
  await ok("upsert_real_reward", {
    id: reward.id,
    expected_version: 1,
    title: "电影之夜",
    energy_cost: 80,
  });
  assert.equal((await rpc("redeem_reward", rp)).code, "PRICE_CHANGED");
});
await run("T13 建筑 AND 条件、同步幂等", async () => {
  const t2 = await ok("upsert_task", {
    title: "小步",
    category: "life",
    energy_reward: 150,
    recurrence: "once",
  });
  await ok("complete_task", {
    task_id: t2.id,
    expected_task_version: 1,
    actual_minutes: 0,
  });
  assert.equal(
    await scalar(
      "select level from public.world_buildings where building_key='research_lab'",
    ),
    1,
  );
  let events = await scalar("select count(*)::int from public.timeline_events");
  await ok("sync_world");
  assert.equal(
    await scalar("select count(*)::int from public.timeline_events"),
    events,
  );
});
await run("T11 虚拟唯一购买和装备", async () => {
  await ok("redeem_reward", {
    virtual_key: "beacon",
    expected_cost: 100,
    expected_source_version: 1,
  });
  assert.equal(
    (
      await rpc("redeem_reward", {
        virtual_key: "beacon",
        expected_cost: 100,
        expected_source_version: 1,
      })
    ).code,
    "ALREADY_OWNED",
  );
  await ok("equip_decoration", { virtual_key: "beacon", equipped: true });
  assert.equal(
    await scalar("select equipped from public.user_inventory"),
    true,
  );
});
await run("T07 配额不部分发放", async () => {
  await db.exec("update private.economy_rules set max_daily_energy=310");
  let t3 = await ok("upsert_task", {
    title: "过限",
    category: "life",
    energy_reward: 20,
    recurrence: "daily",
  });
  assert.equal(
    (
      await rpc("complete_task", {
        task_id: t3.id,
        expected_task_version: 1,
        actual_minutes: 0,
      })
    ).code,
    "DAILY_LIMIT_REACHED",
  );
  assert.equal(
    await scalar("select count(*)::int from public.task_completions"),
    2,
  );
  await db.exec("update private.economy_rules set max_daily_energy=3000");
});
await run("T15 写流水时注入故障完整回滚", async () => {
  const t4 = await ok("upsert_task", {
    title: "故障验证",
    category: "life",
    energy_reward: 10,
    recurrence: "once",
  });
  await db.exec(
    "create function private.fail_ledger() returns trigger language plpgsql as $$begin raise exception 'injected'; end$$; create trigger inject before insert on public.energy_transactions for each row execute function private.fail_ledger();",
  );
  await assert.rejects(() =>
    rpc("complete_task", {
      task_id: t4.id,
      expected_task_version: 1,
      actual_minutes: 0,
    }),
  );
  assert.equal(
    await scalar("select count(*)::int from public.task_completions"),
    2,
  );
  assert.equal(await scalar("select energy_balance from public.wallets"), 100);
  await db.exec("drop trigger inject on public.energy_transactions");
});
await run("T16/T17 双用户 RLS 和直接写权限", async () => {
  await as(v);
  await ok("finish_onboarding", { nickname: "另一个人", timezone: "UTC" });
  await db.exec("set role authenticated");
  assert.equal(
    await scalar("select count(*)::int from public.task_completions"),
    0,
  );
  assert.equal((await rpc("complete_task", p)).code, "NOT_FOUND_OR_FORBIDDEN");
  await assert.rejects(() =>
    db.exec("update public.wallets set energy_balance=900"),
  );
  await assert.rejects(() => db.exec("select * from private.rpc_requests"));
  await db.exec("reset role");
  await as(u);
});
await run("T05 服务器周期跨年、DST", async () => {
  assert.equal(
    await scalar("select private.period_key('weekly','2027-01-01')"),
    "W:2026-12-28",
  );
  assert.equal(
    await scalar(
      "select private.period_key('daily',('2026-11-01 05:30Z'::timestamptz at time zone 'America/New_York')::date)",
    ),
    await scalar(
      "select private.period_key('daily',('2026-11-01 06:30Z'::timestamptz at time zone 'America/New_York')::date)",
    ),
  );
});
await run("T22 钱包、XP、流水全历史对账", async () => {
  assert.equal(
    await scalar(
      `select count(*)::int from public.wallets w where energy_balance<>(select coalesce(sum(amount),0) from public.energy_transactions e where e.user_id=w.user_id) or lifetime_earned<>(select coalesce(sum(amount),0) from public.energy_transactions e where e.user_id=w.user_id and amount>0) or lifetime_spent<>-(select coalesce(sum(amount),0) from public.energy_transactions e where e.user_id=w.user_id and amount<0)`,
    ),
    0,
  );
  assert.equal(
    await scalar(
      "select count(*)::int from public.user_worlds w where total_world_xp<>(select coalesce(sum(xp_awarded),0) from public.task_completions c where c.user_id=w.user_id)",
    ),
    0,
  );
});
await run("读接口、分页导出、7/30天零补齐", async () => {
  const home = (await db.query("select public.get_home_context() h")).rows[0].h;
  assert.equal(home.wallet.energy_balance, 100);
  assert.equal(
    (await db.query("select public.get_statistics(7) s")).rows[0].s.length,
    7,
  );
  const page = (
    await db.query("select public.export_my_data('tasks',null,2) p")
  ).rows[0].p;
  assert.equal(page.rows.length, 2);
  assert.ok(page.next_cursor);
  await assert.rejects(() =>
    db.query("select public.export_my_data('auth.users')"),
  );
});
await run("T06 编辑/暂停不重置周期，归档后旧 UUID 仍可重放", async () => {
  await ok("set_task_status", {
    id: t.id,
    expected_version: 1,
    next_status: "paused",
  });
  await ok("set_task_status", {
    id: t.id,
    expected_version: 2,
    next_status: "active",
  });
  await ok("upsert_task", {
    id: t.id,
    expected_version: 3,
    title: "修改后的标题",
    category: "life",
    energy_reward: 10,
    recurrence: "once",
    start_date: "2020-01-01",
  });
  assert.equal(
    (await rpc("complete_task", { ...p, expected_task_version: 4 })).code,
    "ALREADY_COMPLETED",
  );
  await ok("set_task_status", {
    id: t.id,
    expected_version: 4,
    next_status: "archived",
  });
  assert.deepEqual(await ok("complete_task", p, rid), first);
  assert.equal(
    await scalar(
      "select task_title_snapshot from public.task_completions where task_id='" +
        t.id +
        "'",
    ),
    "研究",
  );
});
await run("T04 跨日确认保护（服务器当前日期为权威）", async () => {
  const task = await ok("upsert_task", {
    title: "每日行动",
    category: "life",
    energy_reward: 1,
    recurrence: "daily",
  });
  assert.equal(
    (
      await rpc("complete_task", {
        task_id: task.id,
        expected_task_version: 1,
        actual_minutes: 0,
        confirmed_local_date: "2000-01-01",
      })
    ).code,
    "PERIOD_CHANGED",
  );
});
await run("T13 XP足够而学习不足不解锁，补齐后出现", async () => {
  await as(v);
  const x = await ok("upsert_task", {
    title: "学习探索",
    category: "study",
    energy_reward: 300,
    recurrence: "once",
  });
  await ok("complete_task", {
    task_id: x.id,
    expected_task_version: 1,
    actual_minutes: 0,
  });
  assert.equal(
    await scalar(
      "select count(*)::int from public.world_buildings where user_id='" +
        v +
        "' and building_key='research_lab'",
    ),
    0,
  );
  const y = await ok("upsert_task", {
    title: "学习三百分钟",
    category: "study",
    energy_reward: 1,
    recurrence: "once",
  });
  await ok("complete_task", {
    task_id: y.id,
    expected_task_version: 1,
    actual_minutes: 300,
  });
  assert.equal(
    await scalar(
      "select level from public.world_buildings where user_id='" +
        v +
        "' and building_key='research_lab'",
    ),
    1,
  );
  await as(u);
});
await run("T15 兑换中途故障回滚扣款", async () => {
  await db.exec(
    "create trigger inject before insert on public.energy_transactions for each row execute function private.fail_ledger();",
  );
  await assert.rejects(() =>
    rpc("redeem_reward", {
      real_reward_id: reward.id,
      expected_cost: 80,
      expected_source_version: 2,
    }),
  );
  assert.equal(
    await scalar(
      "select energy_balance from public.wallets where user_id='" + u + "'",
    ),
    100,
  );
  await db.exec("drop trigger inject on public.energy_transactions");
});
await run("T12 花光余额不影响XP/等级/建筑/成就", async () => {
  const before = await db.query(
    "select * from public.user_worlds order by user_id",
  );
  const b = await scalar("select count(*)::int from public.world_buildings");
  const a = await scalar("select count(*)::int from public.user_achievements");
  const rw = await ok("upsert_real_reward", {
    title: "用完能量",
    energy_cost: 100,
  });
  await ok("redeem_reward", {
    real_reward_id: rw.id,
    expected_cost: 100,
    expected_source_version: 1,
  });
  assert.deepEqual(
    (await db.query("select * from public.user_worlds order by user_id")).rows,
    before.rows,
  );
  assert.equal(
    await scalar("select count(*)::int from public.world_buildings"),
    b,
  );
  assert.equal(
    await scalar("select count(*)::int from public.user_achievements"),
    a,
  );
});
await run("T19 目标进度按历史关联，手动完成不赠奖", async () => {
  const goal = await ok("upsert_goal", {
    title: "阅读计划",
    category: "study",
    target_count: 2,
    is_primary: true,
  });
  const task = await ok("upsert_task", {
    title: "阅读",
    category: "study",
    energy_reward: 5,
    recurrence: "once",
    goal_id: goal.id,
  });
  await ok("complete_task", {
    task_id: task.id,
    expected_task_version: 1,
    actual_minutes: 5,
  });
  await ok("upsert_task", {
    id: task.id,
    expected_version: 1,
    title: "阅读",
    category: "study",
    energy_reward: 5,
    recurrence: "once",
    goal_id: null,
    start_date: "2020-01-01",
  });
  assert.equal(
    await scalar(
      "select count(*)::int from public.task_completions where goal_id_snapshot='" +
        goal.id +
        "'",
    ),
    1,
  );
  const before = await scalar(
    "select energy_balance from public.wallets where user_id='" + u + "'",
  );
  await ok("set_goal_status", {
    id: goal.id,
    expected_version: 1,
    next_status: "completed",
  });
  assert.equal(
    await scalar(
      "select energy_balance from public.wallets where user_id='" + u + "'",
    ),
    before,
  );
});
await run("T18 连续日按去重日期计算，空日中断", async () => {
  await as(v);
  await db.query(
    "update public.task_completions set local_date=current_date-2 where user_id=$1",
    [v],
  );
  let m = (await db.query("select public.get_growth_metrics() m")).rows[0].m;
  assert.equal(m.current_streak, 0);
  assert.equal(m.longest_streak, 1);
  const task = await ok("upsert_task", {
    title: "今日行动",
    category: "life",
    energy_reward: 1,
    recurrence: "once",
  });
  await ok("complete_task", {
    task_id: task.id,
    expected_task_version: 1,
    actual_minutes: 0,
  });
  m = (await db.query("select public.get_growth_metrics() m")).rows[0].m;
  assert.equal(m.current_streak, 1);
  assert.equal(m.longest_streak, 1);
  await as(u);
});
await run("T21 注销锁定后写入被拒绝", async () => {
  await db.query("select public.lock_account_deletion($1)", [v]);
  await as(v);
  assert.equal((await rpc("sync_world")).code, "ACCOUNT_DELETING");
  await as(u);
});
await worldFixtures(db);
console.log(
  "Embedded PostgreSQL tests passed. True multi-connection concurrency / Supabase Storage / Auth / Edge require local Supabase.",
);
await db.close();
