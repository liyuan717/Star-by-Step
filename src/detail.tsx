import { BackupPanel } from "./backup-ui";
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert } from "react-native";
import { getRow, countRows, write, readRpc } from "./backend";
import { useHome, useRows } from "./providers";
import { Button, Card, Choices, Field, Screen, Txt, c } from "./ui";
import { ConfirmAction } from "./actions";
import { categories, categoryNames, buildingNames, taskSchema } from "./domain";
import { PagedList } from "./tabs";

import { PrivateImage, pickMedia } from "./media";
import { World } from "./world";

export function Detail({ parts }: { parts: string[] }) {
  const [type, id, edit] = parts;
  const h = useHome();
  const qc = useQueryClient();
  const [error, E] = useState(""),
    [busy, B] = useState(false),
    [action, A] = useState(false);
  const table =
    type === "redemptions"
      ? "redemptions"
      : ["tasks", "goals", "rewards"].includes(type)
        ? type
        : null;
  const q = useQuery({
    queryKey: ["detail", table, id],
    queryFn: () => getRow(table!, id),
    enabled: !!table && !!id && id !== "new",
  });
  const item = q.data;
  async function mutate(op: string, payload: Record<string, unknown>) {
    if (busy) return;
    B(true);
    E("");
    try {
      await write(op, payload);
      await qc.invalidateQueries();
    } catch (e) {
      E((e as Error).message);
    } finally {
      B(false);
    }
  }
  if (table && id && (id === "new" || edit === "edit")) {
    if (id !== "new" && q.isPending)
      return (
        <Screen title="读取中" loading>
          <Txt>正在获取最新版本…</Txt>
        </Screen>
      );
    return (
      <Editor
        key={id + String(item?.version || 0)}
        type={type}
        item={item}
        loading={id !== "new" && q.isPending}
        missing={id !== "new" && !q.isPending && !item}
      />
    );
  }
  if (table && id)
    return (
      <Screen
        title={item?.title || item?.title_snapshot || "详情"}
        loading={q.isPending}
        error={q.error}
        refresh={() => q.refetch()}
      >
        {!q.isPending && !item ? (
          <Card>
            <Txt>内容不存在或无法访问</Txt>
          </Card>
        ) : (
          item && (
            <>
              <Card>
                <PrivateImage
                  path={item.image_path || item.image_path_snapshot}
                />
                <Txt>
                  {item.description ||
                    item.description_snapshot ||
                    "每一步都算数。"}
                </Txt>
                <Txt muted>
                  状态：{item.status} · 版本{" "}
                  {item.version || item.source_version}
                </Txt>
                {type === "tasks" && (
                  <>
                    <Txt color={c.gold}>
                      {item.energy_reward} ENERGY / WORLD XP
                    </Txt>
                    <Txt muted>
                      {categoryNames[item.category]} · {item.recurrence} ·{" "}
                      {item.start_date} 至 {item.end_date || "不限"}
                    </Txt>
                    <Txt muted>
                      预计 {item.estimated_minutes || 0} 分钟
                      {item.due_date ? ` · 截止 ${item.due_date}` : ""}
                    </Txt>
                    {item.status === "active" && (
                      <Button
                        title="确认完成任务"
                        disabled={busy}
                        onPress={() => A(true)}
                      />
                    )}
                  </>
                )}
                {type === "goals" && <GoalProgress item={item} />}{" "}
                {type === "rewards" && (
                  <>
                    <Txt color={c.gold}>{item.energy_cost} ENERGY</Txt>
                    {item.status === "active" && (
                      <Button title="兑换奖励" onPress={() => A(true)} />
                    )}
                  </>
                )}
                {type === "redemptions" && (
                  <>
                    <Txt color={c.gold}>已消费 {item.energy_spent} ENERGY</Txt>
                    {item.status === "redeemed" && (
                      <Button
                        title="标记为已享用"
                        disabled={busy}
                        onPress={() =>
                          mutate("mark_reward_enjoyed", {
                            redemption_id: item.id,
                          })
                        }
                      />
                    )}
                  </>
                )}
                {type !== "redemptions" &&
                  item.status !== "archived" &&
                  item.status !== "completed" && (
                    <Button
                      quiet
                      title="编辑"
                      onPress={() => router.push(`/${type}/${id}/edit`)}
                    />
                  )}
              </Card>
              {["tasks", "goals"].includes(type) &&
                item.status !== "archived" && (
                  <Card>
                    {item.status !== "completed" && (
                      <Button
                        quiet
                        title={item.status === "paused" ? "恢复" : "暂停"}
                        disabled={busy}
                        onPress={() =>
                          mutate(
                            type === "tasks"
                              ? "set_task_status"
                              : "set_goal_status",
                            {
                              id,
                              expected_version: item.version,
                              next_status:
                                item.status === "paused" ? "active" : "paused",
                            },
                          )
                        }
                      />
                    )}{" "}
                    {type === "goals" && item.status === "active" && (
                      <Button
                        title="手动完成目标（无额外积分）"
                        disabled={busy}
                        onPress={() =>
                          Alert.alert(
                            "完成目标",
                            "关联任务将无法继续完成，历史成长保留。",
                            [
                              { text: "返回" },
                              {
                                text: "完成目标",
                                onPress: () =>
                                  mutate("set_goal_status", {
                                    id,
                                    expected_version: item.version,
                                    next_status: "completed",
                                  }),
                              },
                            ],
                          )
                        }
                      />
                    )}
                    <Button
                      quiet
                      title="归档（不可恢复）"
                      disabled={busy}
                      onPress={() =>
                        Alert.alert(
                          "归档",
                          "记录与积分保留，归档后不能恢复。",
                          [
                            { text: "返回" },
                            {
                              text: "归档",
                              onPress: () =>
                                mutate(
                                  type === "tasks"
                                    ? "set_task_status"
                                    : "set_goal_status",
                                  {
                                    id,
                                    expected_version: item.version,
                                    next_status: "archived",
                                  },
                                ),
                            },
                          ],
                        )
                      }
                    />
                  </Card>
                )}
              {type === "rewards" && item.status === "active" && (
                <Button
                  quiet
                  title="归档奖励"
                  disabled={busy}
                  onPress={() =>
                    mutate("archive_reward", {
                      id,
                      expected_version: item.version,
                    })
                  }
                />
              )}{" "}
              {!!error && <Txt color={c.danger}>{error}</Txt>}
              {action && (
                <ConfirmAction
                  kind={type === "tasks" ? "task" : "reward"}
                  item={item}
                  confirmedDate={h.data?.today}
                  balance={Number(h.data?.wallet?.energy_balance || 0)}
                  onClose={() => {
                    A(false);
                    qc.invalidateQueries();
                  }}
                />
              )}
            </>
          )
        )}
      </Screen>
    );
  if (type === "buildings") return <BuildingDetail name={id} />;
  if (type === "statistics") return <Statistics />;
  if (type === "achievements") return <Achievements />;
  if (type === "decorations") return <Decorations />;
  if (type === "settings") return <Settings account={id === "account"} />;
  const lists: Record<string, [string, string]> = {
    wallet: ["ENERGY 流水", "energy_transactions"],
    timeline: ["成长时间线", "timeline_events"],
    redemptions: ["兑换记录", "redemptions"],
    "tasks-list": ["全部任务", "tasks"],
  };
  if (lists[type])
    return (
      <Screen title={lists[type][0]}>
        <PagedList table={lists[type][1]} />
      </Screen>
    );
  return (
    <Screen title="内容不存在">
      <Txt>内容不存在或无法访问</Txt>
    </Screen>
  );
}
function GoalProgress({ item }: { item: any }) {
  const q = useQuery({
    queryKey: ["goal-progress", item.id],
    queryFn: () => countRows("task_completions", { goal_id_snapshot: item.id }),
  });
  return (
    <>
      <Txt color={c.xp}>
        完成 {q.data || 0} / {item.target_count} ·{" "}
        {Math.min(100, Math.round(((q.data || 0) / item.target_count) * 100))}%
      </Txt>
      <Txt muted>按完成时关联快照累计。达到100%后可手动完成目标。</Txt>
      <PagedList table="tasks" goalId={item.id} />
      <Button
        title="添加关联任务"
        quiet
        onPress={() =>
          router.push({ pathname: "/tasks/new", params: { goal: item.id } })
        }
      />
    </>
  );
}
function Editor({
  type,
  item,
  loading,
  missing,
}: {
  type: string;
  item: any;
  loading: boolean;
  missing: boolean;
}) {
  const { goal: initialGoal } = useLocalSearchParams<{ goal?: string }>();
  const h = useHome(),
    goals = useRows("goals"),
    qc = useQueryClient();
  const task = type === "tasks",
    goal = type === "goals";
  const [f, F] = useState<Record<string, string>>({
    title: "",
    description: "",
    category: "other",
    recurrence: "once",
    energy_reward: "20",
    energy_cost: "100",
    target_count: "10",
    start_date: h.data?.today || "",
    end_date: "",
    due_date: "",
    estimated_minutes: "",
    difficulty: "normal",
    deadline: "",
    is_primary: "false",
    goal_id: initialGoal || "",
    image_path: "",
    ...Object.fromEntries(
      Object.keys(item || {}).map((k) => [
        k,
        item[k] === null ? "" : String(item[k]),
      ]),
    ),
  });
  const [busy, B] = useState(false),
    [error, E] = useState("");
  const field = (
    key: string,
    label: string,
    numeric = false,
    multiline = false,
  ) => (
    <Field
      key={key}
      label={label}
      value={f[key]}
      onChangeText={(v) => F({ ...f, [key]: v })}
      numeric={numeric}
      multiline={multiline}
    />
  );
  async function photo() {
    try {
      const path = await pickMedia("rewards");
      if (path) F({ ...f, image_path: path });
    } catch (e) {
      E((e as Error).message);
    }
  }
  async function save() {
    if (busy) return;
    B(true);
    E("");
    try {
      let payload: Record<string, unknown> = {
        id: item?.id || null,
        expected_version: item?.version || null,
        title: f.title.trim(),
        description: f.description,
        category: f.category,
      };
      if (
        !f.title.trim() ||
        f.title.trim().length > 80 ||
        f.description.length > 2000
      )
        throw Error("标题1–80字，描述最多2000字");
      if (task) {
        taskSchema.parse(f);
        payload = {
          ...payload,
          energy_reward: Number(f.energy_reward),
          recurrence: f.recurrence,
          start_date: f.start_date,
          end_date: f.end_date || null,
          due_date: f.due_date || null,
          estimated_minutes: f.estimated_minutes
            ? Number(f.estimated_minutes)
            : null,
          difficulty: f.difficulty,
          goal_id: f.goal_id || null,
        };
      } else if (goal) {
        const n = Number(f.target_count);
        if (!Number.isInteger(n) || n < 1 || n > 10000)
          throw Error("目标次数应为1–10000");
        payload = {
          ...payload,
          target_count: n,
          deadline: f.deadline || null,
          is_primary: f.is_primary === "true",
        };
      } else {
        const n = Number(f.energy_cost);
        if (!Number.isInteger(n) || n < 1 || n > 1000000)
          throw Error("奖励价格应为1–1000000");
        payload = {
          ...payload,
          energy_cost: n,
          image_path: f.image_path || null,
        };
      }
      const result = await write(
        task ? "upsert_task" : goal ? "upsert_goal" : "upsert_real_reward",
        payload,
      );
      await qc.invalidateQueries();
      router.replace(`/${type}/${result.id}`);
    } catch (e) {
      E(
        e instanceof Error
          ? e.message.startsWith("[")
            ? "请检查任务字段和数值范围"
            : e.message
          : "保存失败",
      );
    } finally {
      B(false);
    }
  }
  if (missing)
    return (
      <Screen title="无法编辑">
        <Txt>内容不存在或无法访问</Txt>
      </Screen>
    );
  return (
    <Screen
      title={`${item ? "编辑" : "创建"}${task ? "任务" : goal ? "目标" : "奖励"}`}
      loading={loading}
    >
      <Card>
        {field("title", "标题")}
        {field("description", "描述", false, true)}
        {(task || goal) && (
          <Choices
            value={f.category}
            onChange={(v) => F({ ...f, category: v })}
            items={categories.map((value) => ({
              value,
              label: categoryNames[value],
            }))}
          />
        )}{" "}
        {task && (
          <>
            {field("energy_reward", "ENERGY（1–300，XP 与它相同）", true)}
            {!item && (
              <Choices
                value={f.recurrence}
                onChange={(v) => F({ ...f, recurrence: v })}
                items={[
                  { value: "once", label: "一次性" },
                  { value: "daily", label: "每日" },
                  { value: "weekly", label: "每周" },
                ]}
              />
            )}
            <Txt muted>创建后不可修改周期。</Txt>
            {field("start_date", "开始日期 YYYY-MM-DD")}
            {field("end_date", "结束日期（可空）")}
            {f.recurrence === "once" &&
              field("due_date", "截止日期（可空，逾期仍可完成）")}
            {field("estimated_minutes", "预计分钟（1–480，可空）", true)}
            <Txt muted>关联目标</Txt>
            {goals.hasNextPage && (
              <Button
                quiet
                title="加载更多目标"
                onPress={() => goals.fetchNextPage()}
              />
            )}
            <Choices
              value={f.goal_id}
              onChange={(v) => F({ ...f, goal_id: v })}
              items={[
                { value: "", label: "独立任务" },
                ...(goals.data || [])
                  .filter((g) => g.status === "active")
                  .map((g) => ({ value: g.id, label: g.title })),
              ]}
            />
          </>
        )}
        {goal && (
          <>
            {field("target_count", "目标完成次数（1–10000）", true)}
            <Txt muted>修改次数会改变进度比例，不改写历史。</Txt>
            {field("deadline", "目标截止日期（可空）")}
            <Choices
              value={f.is_primary}
              onChange={(v) => F({ ...f, is_primary: v })}
              items={[
                { value: "false", label: "普通目标" },
                { value: "true", label: "设为主线" },
              ]}
            />
          </>
        )}
        {!task && !goal && (
          <>
            {field("energy_cost", "价格 ENERGY（1–1000000）", true)}
            <Button
              quiet
              title={
                f.image_path
                  ? "已选择奖励图片 · 重新选择"
                  : "选择奖励图片（可选）"
              }
              onPress={photo}
            />
          </>
        )}
        {!!error && <Txt color={c.danger}>{error}</Txt>}
        <Button
          title={busy ? "保存中…" : "保存"}
          disabled={busy || loading}
          onPress={save}
        />
      </Card>
    </Screen>
  );
}
function BuildingDetail({ name }: { name: string }) {
  const h = useHome(),
    b = useRows("world_buildings"),
    rules = useRows("building_levels");
  const stats = useQuery({
    queryKey: ["growth-metrics"],
    queryFn: () => readRpc("get_growth_metrics"),
  });
  const level = b.data?.find((x) => x.building_key === name)?.level || 0;
  const next = rules.data?.find(
    (r) => r.building_key === name && r.level === level + 1,
  );
  return (
    <Screen title={buildingNames[name] || "建筑"}>
      <Card>
        <Txt size={24}>{level ? `Lv.${level}` : "尚未建设"}</Txt>
        <Txt muted>达到所有条件自动升级，无需花费 ENERGY，永不退化。</Txt>
        {next ? (
          <>
            <Txt muted>下一级外观预览 · Lv.{level + 1}（尚未解锁）</Txt>
            <World
              buildings={[
                ...((b.data || []).filter(
                  (x) => x.building_key !== name,
                ) as any),
                { building_key: name, level: level + 1 },
              ]}
            />
            {[
              [
                "累计 WORLD XP",
                Number(h.data?.world?.total_world_xp || 0),
                next.min_xp,
              ],
              [
                "学习分钟",
                stats.data?.study_minutes || 0,
                next.min_study_minutes,
              ],
              ["生活行动", stats.data?.life_count || 0, next.min_life_count],
              [
                "运动行动",
                stats.data?.exercise_count || 0,
                next.min_exercise_count,
              ],
            ].map(([label, value, required]) => (
              <Txt key={label as string}>
                {label}：{value} / {required} · 还差{" "}
                {Math.max(0, Number(required) - Number(value))}
              </Txt>
            ))}
          </>
        ) : (
          <Txt>{level === 3 ? "已达最高建筑等级" : "正在读取条件…"}</Txt>
        )}
      </Card>
    </Screen>
  );
}
function Statistics() {
  const [days, D] = useState("7");
  const q = useQuery({
    queryKey: ["statistics", days],
    queryFn: () => readRpc("get_statistics", { p_days: Number(days) }),
  });
  return (
    <Screen
      title="个人统计"
      loading={q.isPending}
      error={q.error}
      refresh={() => q.refetch()}
    >
      <Choices
        value={days}
        onChange={D}
        items={[
          { value: "7", label: "近7天" },
          { value: "30", label: "近30天" },
        ]}
      />
      {q.data?.map((r: any) => (
        <Card key={r.date}>
          <Txt>
            {r.date} · {r.completions} 次行动
          </Txt>
          <Txt color={c.gold}>
            获得 {r.earned} / 消费 {r.spent} ENERGY
          </Txt>
          <Txt muted>学习 {r.study_minutes} 分钟</Txt>
        </Card>
      ))}
    </Screen>
  );
}
function Achievements() {
  const defs = useRows("achievements"),
    mine = useRows("user_achievements");
  return (
    <Screen
      title="成就图鉴"
      loading={defs.isPending}
      error={defs.error}
      refresh={() => {
        defs.refetch();
        mine.refetch();
      }}
    >
      {defs.data?.map((a) => (
        <Card key={a.key}>
          <Txt size={20}>
            {mine.data?.some((m) => m.achievement_key === a.key) ? "✦" : "◇"}{" "}
            {a.title}
          </Txt>
          <Txt muted>{a.description}</Txt>
          <Txt color={c.xp}>
            {mine.data?.some((m) => m.achievement_key === a.key)
              ? "已解锁 · 永久保留"
              : "等待你的行动"}
          </Txt>
        </Card>
      ))}
    </Screen>
  );
}
function Decorations() {
  const mine = useRows("user_inventory"),
    catalog = useRows("virtual_catalog"),
    qc = useQueryClient();
  const [error, E] = useState(""),
    [busy, B] = useState(false);
  return (
    <Screen
      title="我的装饰"
      loading={mine.isPending}
      error={mine.error}
      refresh={() => mine.refetch()}
    >
      {mine.data?.length ? (
        mine.data.map((i) => (
          <Card key={i.virtual_key}>
            <Txt>
              {catalog.data?.find((v) => v.key === i.virtual_key)?.title}
            </Txt>
            <Button
              title={i.equipped ? "卸下" : "装备"}
              disabled={busy}
              onPress={async () => {
                B(true);
                try {
                  await write("equip_decoration", {
                    virtual_key: i.virtual_key,
                    equipped: !i.equipped,
                  });
                  await qc.invalidateQueries();
                } catch (e) {
                  E((e as Error).message);
                } finally {
                  B(false);
                }
              }}
            />
          </Card>
        ))
      ) : (
        <Card>
          <Txt>尚未拥有装饰</Txt>
          <Button
            title="前往奖励中心"
            onPress={() => router.push("/(tabs)/rewards")}
          />
        </Card>
      )}
      {!!error && <Txt>{error}</Txt>}
    </Screen>
  );
}
function Settings({ account }: { account: boolean }) {
  const h = useHome(),
    qc = useQueryClient();
  const [name, N] = useState(h.data?.profile?.nickname || ""),
    [world, W] = useState(h.data?.world?.world_name || ""),
    [err, E] = useState(""),
    [busy, B] = useState(false);
  async function update(payload: Record<string, unknown>) {
    B(true);
    E("");
    try {
      await write("update_profile", {
        ...payload,
        expected_version: h.data.profile.version,
      });
      await qc.invalidateQueries();
    } catch (e) {
      E((e as Error).message);
    } finally {
      B(false);
    }
  }
  return (
    <Screen title="设置与备份">
      <Card>
        <Txt color={c.success}>完全离线 · 数据仅保存在这台手机</Txt>
        <Field label="昵称" value={name} onChangeText={N} />
        <PrivateImage path={h.data?.profile?.avatar_path} avatar />
        <Button
          title="选择头像"
          quiet
          disabled={busy}
          onPress={async () => {
            try {
              const path = await pickMedia("avatars");
              if (path) await update({ avatar_path: path });
            } catch (e) {
              E((e as Error).message);
            }
          }}
        />
        <Field label="世界名称" value={world} onChangeText={W} />
        <Txt muted>
          固定时区：{h.data?.profile?.timezone}
          。任务周期使用手机时间；请保持系统日期和时间准确。
        </Txt>
        <Button
          title="保存设置"
          disabled={busy}
          onPress={() => {
            void update({ nickname: name, world_name: world });
          }}
        />
      </Card>
      <BackupPanel />
      <Card>
        <Txt size={20}>离线版说明</Txt>
        <Txt muted>
          无需注册、登录、联网或连接电脑。任务、图片、积分和世界均保存于手机SQLite数据库。不会自动上传或跨设备同步。现实奖励是你对自己的承诺，不涉及付款或平台履约。
        </Txt>
        <Txt muted>
          旧版在线数据不会自动删除或导入。若需迁移，请使用一次性迁移工具生成离线完整备份，再在这里校验并导入。
        </Txt>
      </Card>
      {!!err && <Txt color={c.danger}>{err}</Txt>}
    </Screen>
  );
}
