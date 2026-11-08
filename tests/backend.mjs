import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { localStatus } from "./local-status.mjs";
const { url, publicKey, serviceKey } = localStatus();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, options),
  a = createClient(url, publicKey, options),
  b = createClient(url, publicKey, options);
const users = [];
let media;
const passwords = [];
async function call(client, op, p = {}, id = randomUUID()) {
  const { data, error } = await client.rpc(op, {
    p_request_id: id,
    p_payload: p,
  });
  assert.ifError(error);
  assert.equal(data.ok, true, JSON.stringify(data));
  return data.data;
}
try {
  for (const client of [a, b]) {
    const email = `energy-${randomUUID()}@local.invalid`,
      password = randomUUID() + "Aa1!";
    passwords.push(password);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert.ifError(error);
    users.push(data.user.id);
    const login = await client.auth.signInWithPassword({ email, password });
    assert.ifError(login.error);
    await call(client, "finish_onboarding", {
      nickname: "真实后端验收",
      timezone: "Asia/Shanghai",
    });
  }
  console.log("PASS real Supabase Auth password login / JWT / onboarding");
  const goal = await call(a, "upsert_goal", {
    title: "两步行动",
    category: "study",
    target_count: 2,
  });
  const task = await call(a, "upsert_task", {
    title: "阅读",
    category: "study",
    energy_reward: 50,
    recurrence: "once",
    goal_id: goal.id,
  });
  const t2 = await call(a, "upsert_task", {
    title: "练习",
    category: "skill",
    energy_reward: 50,
    recurrence: "once",
    goal_id: goal.id,
  });
  const rid = randomUUID(),
    args = { task_id: task.id, expected_task_version: 1, actual_minutes: 15 };
  const done = await call(a, "complete_task", args, rid);
  assert.deepEqual(await call(a, "complete_task", args, rid), done);
  await call(a, "complete_task", {
    task_id: t2.id,
    expected_task_version: 1,
    actual_minutes: 15,
  });
  await call(a, "set_goal_status", {
    id: goal.id,
    expected_version: 1,
    next_status: "completed",
  });
  const reward = await call(a, "upsert_real_reward", {
    title: "电影之夜",
    energy_cost: 80,
  });
  const r = await call(a, "redeem_reward", {
    real_reward_id: reward.id,
    expected_cost: 80,
    expected_source_version: 1,
  });
  await call(a, "mark_reward_enjoyed", { redemption_id: r.redemption_id });
  const daily = await call(a, "upsert_task", {
    title: "每日行动",
    category: "life",
    energy_reward: 30,
    recurrence: "daily",
  });
  await call(a, "complete_task", {
    task_id: daily.id,
    expected_task_version: 1,
    actual_minutes: 0,
  });
  const home = await a.rpc("get_home_context");
  assert.ifError(home.error);
  assert.equal(Number(home.data.wallet.energy_balance), 50);
  assert.equal(Number(home.data.world.total_world_xp), 130);
  assert.equal(home.data.world.world_level, 2);
  console.log(
    "PASS specification journey: 100 earned -> redeem80 -> daily30 = 50 ENERGY / 130 XP / Lv2",
  );
  const invisible = await b.from("tasks").select("*").eq("id", task.id);
  assert.ifError(invisible.error);
  assert.equal(invisible.data.length, 0);
  const denied = await b.rpc("complete_task", {
    p_request_id: randomUUID(),
    p_payload: args,
  });
  assert.equal(denied.data.code, "NOT_FOUND_OR_FORBIDDEN");
  const wallet = await a
    .from("wallets")
    .update({ energy_balance: 999999 })
    .eq("user_id", users[0]);
  assert.ok(wallet.error);
  console.log(
    "PASS real REST RLS, foreign object RPC denial, direct wallet write denied",
  );
  media = `${users[0]}/avatars/${randomUUID()}.png`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=",
    "base64",
  );
  const uploaded = await a.storage
    .from("user-media")
    .upload(media, png, { contentType: "image/png" });
  assert.ifError(uploaded.error);
  const own = await a.storage.from("user-media").createSignedUrl(media, 60);
  assert.ifError(own.error);
  const other = await b.storage.from("user-media").createSignedUrl(media, 60);
  assert.ok(other.error);
  assert.equal((await fetch(own.data.signedUrl)).status, 200);
  const exported = await a.rpc("export_my_data", {
    p_entity: "tasks",
    p_limit: 30,
  });
  assert.ifError(exported.error);
  assert.equal(exported.data.rows.length, 3);
  console.log(
    "PASS private Storage upload / signed read / cross-user denial / JSON export",
  );
  const wrong = await a.functions.invoke("delete-account", {
    body: { password: "incorrect-password" },
  });
  assert.ok(wrong.error, "Wrong password must be rejected");
  const afterWrong = await a
    .from("profiles")
    .select("deletion_requested_at")
    .single();
  assert.ifError(afterWrong.error);
  assert.equal(afterWrong.data.deletion_requested_at, null);
  const removed = await a.functions.invoke("delete-account", {
    body: { password: passwords[0] },
  });
  assert.ifError(removed.error);
  assert.equal(removed.data.ok, true);
  users.shift();
  media = null;
  console.log(
    "PASS real Edge account deletion / password reauthentication / cascading cleanup",
  );
} finally {
  if (media) await admin.storage.from("user-media").remove([media]);
  for (const id of users) {
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) {
      console.error("Test account cleanup failed");
      process.exitCode = 1;
    }
  }
}
