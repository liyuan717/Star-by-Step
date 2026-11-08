import { useRef, useState } from "react";
import { Modal } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, Field, Screen, Txt, c } from "./ui";
import { write } from "./backend";
import { categoryNames } from "./domain";
import { SuccessMark } from "./success";
export function ConfirmAction({
  kind,
  item,
  balance = 0,
  onClose,
  confirmedDate,
}: {
  kind: "task" | "reward" | "virtual";
  item: Record<string, any>;
  balance?: number;
  onClose: () => void;
  confirmedDate?: string;
}) {
  const [busy, B] = useState(false),
    [error, E] = useState(""),
    [success, S] = useState(false),
    [minutes, M] = useState(String(item.estimated_minutes || 0));
  const qc = useQueryClient();
  const submitting = useRef(false);
  async function confirm() {
    if (submitting.current) return;
    submitting.current = true;
    B(true);
    try {
      if (kind === "task") {
        const n = Number(minutes);
        if (!Number.isInteger(n) || n < 0 || n > 480)
          throw Error("实际时长应为0–480分钟");
        await write("complete_task", {
          task_id: item.id,
          actual_minutes: n,
          expected_task_version: item.version,
          ...(confirmedDate ? { confirmed_local_date: confirmedDate } : {}),
        });
      } else
        await write("redeem_reward", {
          real_reward_id: kind === "reward" ? item.id : null,
          virtual_key: kind === "virtual" ? item.key : null,
          expected_source_version: item.version,
          expected_cost: item.energy_cost,
        });
      await qc.invalidateQueries();
      S(true);
    } catch (e) {
      E((e as Error).message);
    } finally {
      submitting.current = false;
      B(false);
    }
  }
  return (
    <Modal
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <Screen
        title={
          success ? "行动已记录" : kind === "task" ? "确认完成" : "确认兑换"
        }
      >
        <Card>
          <Txt size={24}>{item.title}</Txt>
          {success ? (
            <>
              <SuccessMark />
              <Txt color={c.success}>
                {kind === "task"
                  ? `+${item.energy_reward} ENERGY / +${item.energy_reward} WORLD XP`
                  : "兑换已成功。WORLD XP 与世界成长完整保留。"}
              </Txt>
              <Button title="继续" onPress={onClose} />
            </>
          ) : (
            <>
              <Txt muted>
                {kind === "task"
                  ? `${categoryNames[item.category]} · ${item.recurrence === "once" ? "一次性" : item.recurrence === "daily" ? "每日一次" : "每周一次"} · 完成后不可撤销`
                  : "自我奖励承诺，兑换后不能撤销或退款"}
              </Txt>
              <Txt color={c.gold}>
                {kind === "task"
                  ? `获得 ${item.energy_reward} ENERGY 与等量 XP`
                  : `${balance} − ${item.energy_cost} = ${balance - item.energy_cost} ENERGY`}
              </Txt>
              {kind === "task" && (
                <Field
                  label="实际分钟（0–480，不影响奖励）"
                  numeric
                  value={minutes}
                  onChangeText={M}
                />
              )}
              <Txt muted size={14}>
                {kind === "task"
                  ? "按本机保存操作时的固定时区日期计算。若已跨日，请返回刷新周期再确认。"
                  : "价格若已变化，本地事务会拒绝旧价格。"}
              </Txt>
              {!!error && <Txt color={c.danger}>{error}</Txt>}
              <Button
                title={busy ? "正在确认…" : "确认"}
                disabled={
                  busy ||
                  !!error ||
                  (kind !== "task" && balance < item.energy_cost)
                }
                onPress={() => {
                  void confirm();
                }}
              />
              <Button
                quiet
                title={error ? "关闭并刷新" : "返回"}
                disabled={busy}
                onPress={onClose}
              />
            </>
          )}
        </Card>
      </Screen>
    </Modal>
  );
}
