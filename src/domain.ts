import { z } from "zod";
export const categories = [
  "study",
  "exercise",
  "work",
  "skill",
  "life",
  "other",
] as const;
export const categoryNames: Record<string, string> = {
  study: "学习",
  exercise: "运动",
  work: "工作",
  skill: "技能",
  life: "生活",
  other: "其他",
};
export const buildingNames: Record<string, string> = {
  base: "太空基地",
  energy_hub: "能源中心",
  research_lab: "研究中心",
  greenhouse: "生物温室",
  training_pod: "训练舱",
};
export const thresholds = [
  0, 100, 300, 700, 1500, 3000, 5500, 9000, 14000, 20000,
];
export function levelFor(xp: number) {
  return thresholds.filter((t) => xp >= t).length;
}
export function safeInteger(value: unknown) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 9_000_000_000_000)
    throw Error("数值超出安全范围");
  return n;
}
export function periodKey(recurrence: string, date: string) {
  if (recurrence === "once") return "once";
  if (recurrence === "daily") return `D:${date}`;
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return `W:${d.toISOString().slice(0, 10)}`;
}
export const taskSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().max(2000),
  energy_reward: z.coerce.number().int().min(1).max(300),
  category: z.enum(categories),
  recurrence: z.enum(["once", "daily", "weekly"]),
});
export const errors: Record<string, string> = {
  NOT_FOUND_OR_FORBIDDEN: "内容不存在或无法访问",
  TASK_INACTIVE: "任务已暂停或归档",
  GOAL_INACTIVE: "目标已暂停或结束",
  OUTSIDE_ACTIVE_DATES: "不在任务有效日期内",
  ALREADY_COMPLETED: "本周期已完成",
  PERIOD_CHANGED: "账户日期已变化，请关闭、刷新后重新确认本周期",
  DAILY_LIMIT_REACHED: "今日领取已达上限，明日可继续",
  INSUFFICIENT_ENERGY: "ENERGY 不足",
  PRICE_CHANGED: "价格已变更，请刷新后重新确认",
  VERSION_CONFLICT: "内容版本已变化，请刷新后重试",
  ALREADY_OWNED: "你已拥有这件装饰",
  NOT_OWNED: "请先购买这件装饰",
  IDEMPOTENCY_CONFLICT: "请求标识与原操作冲突",
  VALIDATION_ERROR: "请检查填写内容和数值范围",
  VALUE_LIMIT_REACHED: "已达到数值安全上限",
  ACCOUNT_DELETING: "账户正在注销，请继续完成注销",
  NETWORK_UNKNOWN: "有一笔本地操作待确认，请先恢复原请求",
  SERVER_ERROR: "本地操作失败，请重试",
};
