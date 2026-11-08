import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
// Administrator fixture only: never bundled or exposed through RPC.
export async function worldFixtures(db) {
  for (const xp of [0, 100, 300, 700, 1500, 20000]) {
    const user = randomUUID();
    await db.query("insert into auth.users(id) values($1)", [user]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.query("select public.finish_onboarding($1,$2)", [
      randomUUID(),
      JSON.stringify({ nickname: `fixture-${xp}`, timezone: "UTC" }),
    ]);
    const n = xp === 20000 ? 124 : Math.ceil(xp / 300);
    if (n) {
      const task = randomUUID();
      await db.query(
        "insert into public.tasks(id,user_id,title,category,energy_reward,recurrence,start_date) values($1,$2,'历史fixture行动','other',1,'daily','1900-01-01')",
        [task, user],
      );
      let earned = 0;
      for (let i = 0; i < n; i++) {
        const amount = i === n - 1 ? xp - earned : Math.floor(xp / n);
        earned += amount;
        const category =
          xp === 20000
            ? i < 60
              ? "exercise"
              : i < 120
                ? "life"
                : "study"
            : "other";
        const cid = randomUUID();
        await db.query(
          `insert into public.task_completions(id,user_id,task_id,period_key,completed_at,local_date,timezone_snapshot,task_title_snapshot,category_snapshot,energy_awarded,xp_awarded,actual_minutes,task_version,rule_version)
      values($1,$2,$3,'D:'||(current_date-$4::int)::text,(current_date-$4::int)::timestamptz,current_date-$4::int,'UTC','历史fixture行动',$5,$6,$6,$7,1,1)`,
          [
            cid,
            user,
            task,
            n - i - 1,
            category,
            amount,
            category === "study" ? 480 : 0,
          ],
        );
        await db.query(
          "insert into public.energy_transactions(user_id,amount,type,completion_id,balance_after,created_at) values($1,$2,'task',$3,$4,clock_timestamp())",
          [user, amount, cid, earned],
        );
      }
      await db.query(
        "update public.wallets set energy_balance=$1,lifetime_earned=$1 where user_id=$2",
        [xp, user],
      );
      await db.query(
        "update public.user_worlds set total_world_xp=$1 where user_id=$2",
        [xp, user],
      );
      await db.query("select private.sync_growth($1,clock_timestamp())", [
        user,
      ]);
    }
    const world = (
      await db.query("select * from public.user_worlds where user_id=$1", [
        user,
      ])
    ).rows[0];
    assert.equal(Number(world.total_world_xp), xp);
    assert.equal(
      world.world_level,
      [0, 100, 300, 700, 1500, 3000, 5500, 9000, 14000, 20000].filter(
        (t) => xp >= t,
      ).length,
    );
    if (xp === 20000) {
      const b = (
        await db.query(
          "select * from public.world_buildings where user_id=$1",
          [user],
        )
      ).rows;
      assert.equal(b.length, 5);
      assert.ok(b.every((x) => x.level === 3));
    }
    console.log(`PASS world fixture ${xp} XP / Lv.${world.world_level}`);
  }
}
