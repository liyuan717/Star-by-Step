import { test } from "node:test";
import assert from "node:assert/strict";
import { levelFor, periodKey, safeInteger, taskSchema } from "../src/domain";
test("等级边界与上限", () => {
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(99), 1);
  assert.equal(levelFor(100), 2);
  assert.equal(levelFor(300), 3);
  assert.equal(levelFor(999999), 10);
});
test("周期周一与跨年", () => {
  assert.equal(periodKey("once", "2026-11-08"), "once");
  assert.equal(periodKey("daily", "2026-11-08"), "D:2026-11-08");
  assert.equal(periodKey("weekly", "2027-01-01"), "W:2026-12-28");
  assert.equal(periodKey("weekly", "2027-01-04"), "W:2027-01-04");
});
test("禁止精度丢失与非法奖励", () => {
  assert.throws(() => safeInteger("9007199254740993"));
  assert.throws(() => safeInteger(1.5));
  assert.equal(safeInteger("9000000000000"), 9000000000000);
  assert.equal(
    taskSchema.safeParse({
      title: "行动",
      description: "",
      energy_reward: 301,
      category: "life",
      recurrence: "daily",
    }).success,
    false,
  );
});
