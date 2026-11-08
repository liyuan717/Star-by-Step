import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { LocalEngine, LocalError } from "../src/local/engine";
import { Sql } from "../src/local/sql";
import { Runtime, canonical } from "../src/local/model";
import { makeBackup, parseBackup } from "../src/local/backup";
import { migrateLegacy, LEGACY_TABLES } from "../src/local/legacy";

function adapter(db: DatabaseSync): Sql {
  return {
    execAsync: async (s) => {
      db.exec(s);
    },
    runAsync: async (s, ...p) => db.prepare(s).run(...p),
    getAllAsync: async <T>(s: string, ...p: any[]) =>
      db.prepare(s).all(...p) as T[],
  };
}
function setup(file = ":memory:") {
  let now = new Date("2026-11-08T03:00:00Z");
  const db = new DatabaseSync(file);
  const env: Runtime = {
    id: randomUUID,
    now: () => now,
    hash: async (s) => createHash("sha256").update(s).digest("hex"),
  };
  const engine = new LocalEngine(adapter(db), env);
  return {
    engine,
    env,
    db,
    clock: (date: string) => {
      now = new Date(date);
    },
  };
}
async function world(e: LocalEngine) {
  await e.init();
  await e.write("finish_onboarding", {
    nickname: "OfflineTester",
    timezone: "Asia/Shanghai",
  });
}
async function task(e: LocalEngine, p: Record<string, unknown> = {}) {
  return e.write("upsert_task", {
    title: "任务",
    description: "",
    category: "study",
    energy_reward: 50,
    recurrence: "once",
    ...p,
  });
}
async function complete(
  e: LocalEngine,
  id: string,
  rid?: string,
  minutes = 15,
) {
  return e.write(
    "complete_task",
    { task_id: id, expected_task_version: 1, actual_minutes: minutes },
    rid,
  );
}
const errorCode = (code: string) => (e: unknown) =>
  e instanceof LocalError && e.code === code;

test("本地历史按日期和记录 ID 分页，同一时间的记录不跳页", async () => {
  const { engine, db, clock } = setup();
  await world(engine);
  const first = await task(engine);
  const second = await task(engine);
  const ignored = await task(engine, { category: "exercise" });
  clock("2026-11-09T03:00:00Z");
  const newest = await task(engine);
  const ids: string[] = [];
  let cursor: { time: string; id: string } | undefined;
  for (let index = 0; index < 4; index++) {
    const page = await engine.page("tasks", { category: "study" }, 1, cursor);
    if (index === 3) {
      assert.deepEqual(page, []);
      break;
    }
    assert.equal(page.length, 1);
    ids.push(page[0].id);
    cursor = { time: page[0].created_at, id: page[0].id };
  }
  assert.deepEqual(ids, [newest.id, ...[first.id, second.id].sort().reverse()]);
  assert.equal(await engine.count("tasks", { category: "exercise" }), 1);
  assert.equal((await engine.row("tasks", ignored.id))?.id, ignored.id);
  assert.equal(await engine.row("tasks", randomUUID()), null);
  db.close();
});

test("SQLite首次启动无账户；三任务、现实奖励、享用、统计、流水、重开持久化", async () => {
  const dir = fs.mkdtempSync(path.resolve(".tmp/offline-")),
    file = path.join(dir, "world.db");
  const x = setup(file);
  await world(x.engine);
  let h = await x.engine.read("get_home_context");
  assert.equal(h.wallet.energy_balance, 0);
  assert.equal(h.world.total_world_xp, 0);
  const goal = await x.engine.write("upsert_goal", {
    title: "两步目标",
    target_count: 2,
    category: "study",
  });
  const a = await task(x.engine, { goal_id: goal.id }),
    b = await task(x.engine, { goal_id: goal.id, category: "skill" });
  await complete(x.engine, a.id);
  await complete(x.engine, b.id);
  await x.engine.write("set_goal_status", {
    id: goal.id,
    expected_version: 1,
    next_status: "completed",
  });
  const reward = await x.engine.write("upsert_real_reward", {
    title: "电影之夜",
    energy_cost: 80,
  });
  const r = await x.engine.write("redeem_reward", {
    real_reward_id: reward.id,
    expected_cost: 80,
    expected_source_version: 1,
  });
  await x.engine.write("mark_reward_enjoyed", {
    redemption_id: r.redemption_id,
  });
  const daily = await task(x.engine, {
    recurrence: "daily",
    energy_reward: 30,
    category: "life",
  });
  await complete(x.engine, daily.id);
  h = await x.engine.read("get_home_context");
  assert.equal(h.wallet.energy_balance, 50);
  assert.equal(h.world.total_world_xp, 130);
  assert.equal(h.world.world_level, 2);
  assert.equal(h.pending.length, 0);
  assert.equal(
    (await x.engine.read("get_statistics", { p_days: 7 })).at(-1).earned,
    130,
  );
  assert.equal((await x.engine.read("get_growth_metrics")).completion_count, 3);
  assert.equal((await x.engine.rows("redemptions"))[0].status, "enjoyed");
  assert.equal((await x.engine.read("reconcile")).ok, true);
  x.db.close();
  const y = setup(file);
  await y.engine.init();
  h = await y.engine.read("get_home_context");
  assert.equal(h.wallet.energy_balance, 50);
  assert.equal(h.world.total_world_xp, 130);
  y.db.close();
});
test("20并发周期完成、UUID重放及冲突、并发扣款、SQLite唯一约束", async () => {
  const { engine: e, db } = setup();
  await world(e);
  const a = await task(e, { energy_reward: 150 });
  const outcomes = await Promise.allSettled(
    Array.from({ length: 20 }, () => complete(e, a.id)),
  );
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal((await e.rows("energy_transactions")).length, 1);
  const b = await task(e);
  const rid = randomUUID(),
    first = await complete(e, b.id, rid);
  for (const r of await Promise.all(
    Array.from({ length: 20 }, () => complete(e, b.id, rid)),
  ))
    assert.deepEqual(r, first);
  await assert.rejects(
    e.write("sync_world", {}, rid),
    errorCode("IDEMPOTENCY_CONFLICT"),
  );
  const rw = await e.write("upsert_real_reward", {
    title: "奖励",
    energy_cost: 150,
  });
  const p = {
    real_reward_id: rw.id,
    expected_cost: 150,
    expected_source_version: 1,
  };
  const rs = await Promise.allSettled([
    e.write("redeem_reward", p),
    e.write("redeem_reward", p),
  ]);
  assert.equal(rs.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await e.read("reconcile")).energy, 50);
  const c = (await e.rows("task_completions"))[0];
  assert.throws(
    () =>
      db
        .prepare("INSERT INTO task_completions VALUES(?,?)")
        .run(randomUUID(), JSON.stringify({ ...c, id: randomUUID() })),
    /UNIQUE/,
  );
  db.close();
});
test("固定时区日期、周一周界、版本、暂停、日期边界、单次完成", async () => {
  const x = setup();
  await world(x.engine);
  const e = x.engine,
    a = await task(e, { recurrence: "weekly" }),
    d = await task(e, { recurrence: "daily" });
  await complete(e, a.id);
  await complete(e, d.id);
  await assert.rejects(complete(e, d.id), errorCode("ALREADY_COMPLETED"));
  x.clock("2026-11-08T16:01:00Z");
  assert.equal((await e.read("get_home_context")).today, "2026-11-09");
  await complete(e, a.id);
  await complete(e, d.id);
  const b = await task(e);
  await e.write("set_task_status", {
    id: b.id,
    expected_version: 1,
    next_status: "paused",
  });
  await assert.rejects(complete(e, b.id), errorCode("VERSION_CONFLICT"));
  await assert.rejects(
    e.write("complete_task", {
      task_id: b.id,
      expected_task_version: 2,
      actual_minutes: 0,
    }),
    errorCode("TASK_INACTIVE"),
  );
  await assert.rejects(
    e.write("complete_task", {
      task_id: d.id,
      expected_task_version: 1,
      actual_minutes: 0,
      confirmed_local_date: "2026-11-08",
    }),
    errorCode("PERIOD_CHANGED"),
  );
  const future = await task(e, { start_date: "2026-11-10" });
  await assert.rejects(
    complete(e, future.id),
    errorCode("OUTSIDE_ACTIVE_DATES"),
  );
  await assert.rejects(task(e, { start_date: "2026-02-30" }));
  x.db.close();
});
test("发奖每日限额、失败事务回滚、SQLite异常不出现半笔流水", async () => {
  const { engine: e, db } = setup();
  await world(e);
  for (let i = 0; i < 10; i++) {
    const t = await task(e, { energy_reward: 300 });
    await complete(e, t.id);
  }
  const a = await task(e);
  await assert.rejects(complete(e, a.id), errorCode("DAILY_LIMIT_REACHED"));
  assert.equal((await e.read("reconcile")).energy, 3000);
  const b = await e.write("upsert_real_reward", {
    title: "失败回滚",
    energy_cost: 100,
  });
  db.exec(
    "CREATE TRIGGER fail_ledger BEFORE INSERT ON energy_transactions BEGIN SELECT RAISE(ABORT,'injected failure'); END;",
  );
  await assert.rejects(
    e.write("redeem_reward", {
      real_reward_id: b.id,
      expected_cost: 100,
      expected_source_version: 1,
    }),
    /injected failure/,
  );
  assert.equal((await e.rows("redemptions")).length, 0);
  assert.equal((await e.read("reconcile")).energy, 3000);
  db.close();
});
test("完整图片备份、校验拒绝、导入原子回滚、重复替换不增资产、未完成UUID恢复", async () => {
  const x = setup();
  await world(x.engine);
  const e = x.engine,
    t = await task(e, { energy_reward: 200 });
  await complete(e, t.id);
  const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
    hash = await x.env.hash(base64),
    id = `media/${hash}.png`;
  await e.write("save_media", { id, mime: "image/png", base64, sha256: hash });
  const rw = await e.write("upsert_real_reward", {
    title: "带图奖励",
    energy_cost: 80,
    image_path: id,
  });
  await e.write("redeem_reward", {
    real_reward_id: rw.id,
    expected_cost: 80,
    expected_source_version: 1,
  });
  const backup = await makeBackup(await e.snapshot(), x.env),
    parsed = await parseBackup(JSON.stringify(backup), x.env);
  assert.equal(parsed.payload.tables.media[0].base64, base64);
  const y = setup();
  await world(y.engine);
  await y.engine.replace(parsed.payload.tables);
  await y.engine.replace(parsed.payload.tables);
  assert.equal((await y.engine.read("reconcile")).energy, 120);
  assert.equal((await y.engine.rows("redemptions")).length, 1);
  assert.equal((await y.engine.rows("media"))[0].base64, base64);
  const broken = structuredClone(backup);
  broken.payload.tables.wallets[0].energy_balance += 100;
  await assert.rejects(parseBackup(JSON.stringify(broken), x.env), /校验和/);
  broken.checksum = await x.env.hash(canonical(broken.payload));
  await assert.rejects(parseBackup(JSON.stringify(broken), x.env), /对账/);
  const missing = structuredClone(backup);
  missing.payload.tables.media = [];
  missing.checksum = await x.env.hash(canonical(missing.payload));
  await assert.rejects(parseBackup(JSON.stringify(missing), x.env), /图片/);
  const old = canonical(await y.engine.snapshot());
  y.db.exec(
    "CREATE TRIGGER fail_restore BEFORE INSERT ON media BEGIN SELECT RAISE(ABORT,'restore failure'); END;",
  );
  const changed = structuredClone(parsed.payload.tables);
  changed.media[0].mime = "image/jpeg";
  await assert.rejects(y.engine.replace(changed));
  assert.equal(canonical(await y.engine.snapshot()), old);
  const req = {
    id: randomUUID(),
    op: "upsert_real_reward",
    payload: { title: "恢复原请求", energy_cost: 50 },
  };
  await e.stageIntent(req);
  const receipt = await e.write(req.op, req.payload, req.id);
  const pending = await e.pending();
  assert.equal(pending.id, req.id);
  assert.deepEqual(await e.write(req.op, req.payload, req.id), receipt);
  await e.clearIntent(req.id);
  assert.equal(await e.pending(), null);
  x.db.close();
  y.db.close();
});
test("建筑AND条件、装饰购买/装备唯一及永久XP、成就与七日连续", async () => {
  const x = setup();
  await world(x.engine);
  const e = x.engine;
  for (let i = 0; i < 10; i++) {
    const t = await task(e, {
      energy_reward: 150,
      category: i < 2 ? "study" : "life",
    });
    await complete(e, t.id, undefined, i < 2 ? 150 : 0);
    if (i < 6) x.clock(`2026-11-${String(9 + i).padStart(2, "0")}T03:00:00Z`);
  }
  const b = await e.rows("world_buildings");
  assert.equal(b.find((x) => x.building_key === "research_lab")?.level, 1);
  assert.equal(b.find((x) => x.building_key === "base")?.level, 3);
  assert.equal(
    b.some((x) => x.building_key === "greenhouse"),
    false,
  );
  assert.ok(
    (await e.rows("user_achievements")).some(
      (x) => x.achievement_key === "seven_days",
    ),
  );
  await e.write("redeem_reward", {
    virtual_key: "beacon",
    expected_cost: 100,
    expected_source_version: 1,
  });
  await assert.rejects(
    e.write("redeem_reward", {
      virtual_key: "beacon",
      expected_cost: 100,
      expected_source_version: 1,
    }),
    errorCode("ALREADY_OWNED"),
  );
  await e.write("equip_decoration", { virtual_key: "beacon", equipped: true });
  assert.equal((await e.rows("user_inventory"))[0].equipped, true);
  assert.equal((await e.read("reconcile")).xp, 1500);
  x.db.close();
});
test("意外终止进程未提交SQLite事务会回滚", async () => {
  const dir = fs.mkdtempSync(path.resolve(".tmp/crash-")),
    file = path.join(dir, "world.db");
  const x = setup(file);
  await world(x.engine);
  const t = await task(x.engine);
  await complete(x.engine, t.id);
  x.db.close();
  const script = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN IMMEDIATE');db.exec("UPDATE wallets SET payload=json_set(payload,'$.energy_balance',9999)");process.exit(9);`;
  const r = spawnSync(process.execPath, ["-e", script, file]);
  assert.equal(r.status, 9);
  const y = setup(file);
  await y.engine.init();
  assert.equal((await y.engine.read("reconcile")).energy, 50);
  y.db.close();
});

test("旧版一次性迁移保留资产和图片，缺图则整体拒绝且不改原数据", async () => {
  const x = setup();
  await world(x.engine);
  const t = await task(x.engine);
  await complete(x.engine, t.id);
  const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
    hash = await x.env.hash(base64),
    id = `media/${hash}.png`;
  await x.engine.write("save_media", {
    id,
    mime: "image/png",
    base64,
    sha256: hash,
  });
  await x.engine.write("upsert_real_reward", {
    title: "旧图片奖励",
    energy_cost: 20,
    image_path: id,
  });
  const snapshot = await x.engine.snapshot(),
    old = Object.fromEntries(
      LEGACY_TABLES.map((t) => [t, structuredClone(snapshot[t])]),
    ),
    oldPath = snapshot.profiles[0].user_id + "/rewards/old.png";
  old.rewards[0].image_path = oldPath;
  for (const l of old.energy_transactions) delete l.sequence;
  const untouched = canonical(old);
  await assert.rejects(migrateLegacy(old, {}, x.env), /旧图片缺失/);
  assert.equal(canonical(old), untouched);
  const backup = await migrateLegacy(
    old,
    { [oldPath]: { mime: "image/png", base64 } },
    x.env,
  );
  const checked = await parseBackup(JSON.stringify(backup), x.env);
  assert.equal(checked.payload.tables.wallets[0].energy_balance, 50);
  assert.equal(checked.payload.tables.media[0].base64, base64);
  assert.equal(canonical(old), untouched);
  x.db.close();
});
