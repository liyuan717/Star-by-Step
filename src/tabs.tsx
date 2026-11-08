import { useState, useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useHome, useRows } from "./providers";
import { Button, Card, Choices, Screen, Txt, c, styles } from "./ui";
import { World, BuildingList } from "./world";
import { ConfirmAction } from "./actions";
import { categoryNames, safeInteger, thresholds } from "./domain";
import { PrivateImage } from "./media";
import type { Row } from "./types/database.generated";
import { Pending, getPending, recover, listRows } from "./backend";
import { useQueryClient, useInfiniteQuery } from "@tanstack/react-query";

function PendingBanner() {
  const qc = useQueryClient();
  const [p, P] = useState<Pending | null>(null),
    [error, E] = useState(""),
    [busy, B] = useState(false);
  useEffect(() => {
    void getPending().then(P);
    const timer = setInterval(() => {
      void getPending().then(P);
    }, 2000);
    return () => clearInterval(timer);
  }, []);
  return p ? (
    <Card>
      <Txt color={c.gold}>有一笔操作结果待确认</Txt>
      <Txt muted>
        请求保存在本机SQLite中，恢复原操作会使用同一标识，避免重复记账。
      </Txt>
      <Button
        disabled={busy}
        title="查询并恢复原请求"
        onPress={async () => {
          B(true);
          try {
            await recover(p);
            P(null);
            await qc.invalidateQueries();
          } catch (e) {
            E((e as Error).message);
          } finally {
            B(false);
          }
        }}
      />
      {!!error && <Txt>{error}</Txt>}
    </Card>
  ) : null;
}
export function Home() {
  const h = useHome(),
    build = useRows("world_buildings"),
    inventory = useRows("user_inventory");
  const [action, A] = useState<any>(null);
  const data = h.data;
  const balance = safeInteger(data?.wallet?.energy_balance || 0),
    xp = safeInteger(data?.world?.total_world_xp || 0),
    level = data?.world?.world_level || 1;
  const next = data?.next_reward;
  const progress =
    level >= thresholds.length
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            ((xp - thresholds[level - 1]) /
              (thresholds[level] - thresholds[level - 1])) *
              100,
          ),
        );
  return (
    <Screen
      title={`你好，${data?.profile?.nickname || "开拓者"}`}
      loading={h.isPending}
      error={h.error}
      refresh={() => h.refetch()}
    >
      <PendingBanner />
      <Card style={layout.hero}>
        <View style={[layout.heroTitle, styles.row]}>
          <View style={{ flex: 1 }}>
            <Txt size={21} strong>
              {data?.world?.world_name || "起源星"}
            </Txt>
          </View>
          <View style={layout.level}>
            <Txt size={12} color={c.xp} strong>
              Lv.{level}
            </Txt>
          </View>
        </View>
        <World
          buildings={build.data as any}
          inventory={inventory.data as any}
          showHint={false}
        />
        <View style={layout.metrics}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`可用能量 ${balance}，查看流水`}
            onPress={() => router.push("/wallet")}
            style={({ pressed }) => [
              layout.metric,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Txt size={12} muted>
              可用 ENERGY ↗
            </Txt>
            <Txt size={25} color={c.gold} strong>
              {balance.toLocaleString()}
            </Txt>
          </Pressable>
          <View style={layout.metric}>
            <Txt size={12} muted>
              永久经验
            </Txt>
            <Txt size={25} color={c.xp} strong>
              {xp.toLocaleString()} XP
            </Txt>
          </View>
        </View>
        <View style={layout.progress}>
          <View style={[layout.track, { width: `${progress}%` }]} />
        </View>
        <View style={layout.progressLabel}>
          <Txt muted size={12}>
            {level >= thresholds.length
              ? "等级已满，经验继续累积"
              : `距 Lv.${level + 1} 还需 ${thresholds[level] - xp} XP`}
          </Txt>
        </View>
      </Card>
      <View style={styles.row}>
        <Txt size={20} strong>
          今日行动
        </Txt>
        <Button
          quiet
          compact
          title="＋ 新任务"
          onPress={() => router.push("/tasks/new")}
        />
      </View>
      <Txt muted size={14}>
        已完成 {data?.usage?.completion_count || 0} 项 · 获得{" "}
        {data?.usage?.energy_earned || 0} ENERGY
      </Txt>
      {data?.pending?.length ? (
        data.pending
          .slice(0, 5)
          .map((t: any) => (
            <TaskRow key={t.id} task={t} onComplete={() => A(t)} />
          ))
      ) : (
        <Card>
          <Txt>今天的星际航线还很安静。</Txt>
          <Txt muted>添加一个小行动，开始积累永久成长。</Txt>
        </Card>
      )}
      <Card>
        <Txt size={18} strong>
          下一份奖励
        </Txt>
        <Txt>{next?.title || "给努力留一份期待"}</Txt>
        <Txt color={c.gold}>
          {next
            ? balance >= next.energy_cost
              ? "当前余额可兑换"
              : `还差 ${next.energy_cost - balance} ENERGY`
            : "创建属于你的现实奖励"}
        </Txt>
        <Button
          quiet
          compact
          title={next ? "查看奖励" : "创建奖励"}
          onPress={() =>
            router.push(next ? `/rewards/${next.id}` : "/rewards/new")
          }
        />
      </Card>
      {action && (
        <ConfirmAction
          kind="task"
          item={action}
          confirmedDate={h.data?.today}
          onClose={() => {
            A(null);
            h.refetch();
          }}
        />
      )}
    </Screen>
  );
}
export function TaskRow({
  task: t,
  onComplete,
}: {
  task: Row<"tasks"> & { overdue?: boolean };
  onComplete?: () => void;
}) {
  return (
    <Card>
      <Txt size={17} strong>
        {t.title}
      </Txt>
      <Txt muted size={13}>
        {categoryNames[t.category]} ·{" "}
        {t.recurrence === "weekly"
          ? "本周任务"
          : t.recurrence === "daily"
            ? "每日行动"
            : "一次性行动"}
        {t.due_date ? ` · 截止 ${t.due_date}` : ""}
        {t.overdue ? " · 已逾期，仍可完成" : ""}
      </Txt>
      <View style={layout.taskFooter}>
        <View style={{ flexGrow: 1 }}>
          <Txt color={c.gold} size={13} strong>
            ＋{t.energy_reward} ENERGY / XP
          </Txt>
        </View>
        <View style={layout.actions}>
          <Button
            quiet
            compact
            title="详情"
            onPress={() => router.push(`/tasks/${t.id}`)}
          />
          {onComplete && (
            <Button compact title="完成行动" onPress={onComplete} />
          )}
        </View>
      </View>
    </Card>
  );
}
export function Universe() {
  const b = useRows("world_buildings"),
    i = useRows("user_inventory"),
    h = useHome();
  return (
    <Screen
      title="我的宇宙"
      loading={b.isPending}
      error={b.error}
      refresh={() => {
        b.refetch();
        i.refetch();
      }}
    >
      <Card>
        <Txt size={22} strong>
          {h.data?.world?.world_name || "起源星"}
        </Txt>
        <Txt color={c.xp}>
          Lv.{h.data?.world?.world_level || 1} ·{" "}
          {(h.data?.world?.world_level || 1) < 3
            ? "太空前哨站"
            : "起源星殖民地"}
        </Txt>
        <World buildings={b.data as any} inventory={i.data as any} />
      </Card>
      <BuildingList buildings={b.data as any} />
      <Button
        title="我的装饰"
        quiet
        onPress={() => router.push("/decorations")}
      />
      <Card>
        <Txt>轨道站 · 赤岩星 · 冰环星</Txt>
        <Txt muted>后续版本开放</Txt>
      </Card>
    </Screen>
  );
}
export function Tasks() {
  const h = useHome();
  const [tab, T] = useState("today"),
    [action, A] = useState<any>(null);
  const pending = h.data?.pending ?? [];
  return (
    <Screen
      title="目标与任务"
      refresh={() => h.refetch()}
      loading={h.isPending}
      error={h.error}
    >
      <Choices
        segmented
        items={[
          { label: "今日", value: "today" },
          { label: "目标", value: "goals" },
          { label: "历史", value: "history" },
        ]}
        value={tab}
        onChange={T}
      />
      <Button
        title={tab === "goals" ? "＋ 创建目标" : "＋ 添加任务"}
        onPress={() =>
          router.push(tab === "goals" ? "/goals/new" : "/tasks/new")
        }
      />
      {tab === "today" ? (
        <>
          {pending.map((t: any) => (
            <TaskRow key={t.id} task={t} onComplete={() => A(t)} />
          ))}
          {!h.isPending && !h.error && !pending.length && (
            <Card>
              <Txt muted>当前没有待完成任务。可添加任务或查看全部任务。</Txt>
            </Card>
          )}
          <Button
            quiet
            title="全部任务（含暂停与归档）"
            onPress={() => router.push("/tasks-list")}
          />
        </>
      ) : (
        <PagedList table={tab === "goals" ? "goals" : "task_completions"} />
      )}
      <PendingBanner />
      {action && (
        <ConfirmAction
          kind="task"
          item={action}
          confirmedDate={h.data?.today}
          onClose={() => {
            A(null);
            h.refetch();
          }}
        />
      )}
    </Screen>
  );
}
export function Rewards() {
  const h = useHome(),
    real = useRows("rewards"),
    virtual = useRows("virtual_catalog"),
    inventory = useRows("user_inventory");
  const [tab, T] = useState("real"),
    [action, A] = useState<any>(null);
  const balance = Number(h.data?.wallet?.energy_balance || 0);
  return (
    <Screen
      title="奖励中心"
      loading={real.isPending}
      error={real.error}
      refresh={() => {
        real.refetch();
        virtual.refetch();
        inventory.refetch();
        h.refetch();
      }}
    >
      <Card style={styles.row}>
        <Txt muted size={14}>
          可用 ENERGY
        </Txt>
        <Txt size={26} color={c.gold} strong>
          {balance.toLocaleString()}
        </Txt>
      </Card>
      <Choices
        segmented
        items={[
          { label: "现实奖励", value: "real" },
          { label: "世界装饰", value: "virtual" },
        ]}
        value={tab}
        onChange={T}
      />
      {tab === "real" && (
        <Button
          title="＋ 创建奖励"
          onPress={() => router.push("/rewards/new")}
        />
      )}
      <Button
        quiet
        title="兑换记录"
        onPress={() => router.push("/redemptions")}
      />
      {(tab === "real" ? real.data : virtual.data)
        ?.filter((r) => (tab === "real" ? r.status === "active" : r.active))
        .map((r) => {
          const owned =
            tab === "virtual" &&
            inventory.data?.some((item) => item.virtual_key === r.key);
          return (
            <Card key={r.id || r.key}>
              <PrivateImage path={r.image_path} />
              <Txt size={18} strong>
                {r.title}
              </Txt>
              {!!r.description && (
                <Txt muted size={14}>
                  {r.description}
                </Txt>
              )}
              <Txt color={c.gold} size={14} strong>
                {r.energy_cost} ENERGY
              </Txt>
              {h.data && !owned && balance < r.energy_cost && (
                <Txt muted>还差 {r.energy_cost - balance} ENERGY</Txt>
              )}
              <Button
                compact
                title={
                  tab === "real"
                    ? "查看与兑换"
                    : owned
                      ? "已拥有 · 管理装饰"
                      : "购买装饰"
                }
                onPress={() =>
                  tab === "real"
                    ? router.push(`/rewards/${r.id}`)
                    : owned
                      ? router.push("/decorations")
                      : A(r)
                }
              />
            </Card>
          );
        })}
      {tab === "real" && !real.data?.length && (
        <Card>
          <Txt>电影之夜、喜欢的书、一次短途旅行…</Txt>
          <Txt muted>这是你对自己的奖励承诺，不涉及平台付款或履约。</Txt>
        </Card>
      )}
      {tab === "real" && real.hasNextPage && (
        <Button
          title="加载更多奖励"
          disabled={real.isFetchingNextPage}
          onPress={() => real.fetchNextPage()}
        />
      )}
      {action && (
        <ConfirmAction
          kind="virtual"
          item={action}
          balance={balance}
          onClose={() => {
            A(null);
            h.refetch();
          }}
        />
      )}
    </Screen>
  );
}
export function Profile() {
  const h = useHome();
  return (
    <Screen
      title={h.data?.profile?.nickname || "我的"}
      subtitle={`起源星开拓者 · Lv.${h.data?.world?.world_level || 1}`}
    >
      <Card>
        <Txt color={c.xp} strong>
          永久 WORLD XP · {h.data?.world?.total_world_xp || 0}
        </Txt>
      </Card>
      <Card style={layout.menu}>
        {[
          ["statistics", "个人统计"],
          ["achievements", "成就图鉴"],
          ["timeline", "成长时间线"],
          ["wallet", "ENERGY 流水"],
          ["settings", "设置与备份"],
        ].map(([path, title], index) => (
          <Pressable
            key={path}
            accessibilityRole="button"
            onPress={() => router.push(`/${path}`)}
            style={({ pressed }) => [
              layout.menuItem,
              index > 0 && layout.menuDivider,
              pressed && { backgroundColor: "#1B293D" },
            ]}
          >
            <Txt size={15}>{title}</Txt>
            <Txt size={17} muted>
              ›
            </Txt>
          </Pressable>
        ))}
      </Card>
      <PendingBanner />
    </Screen>
  );
}

const layout = StyleSheet.create({
  hero: { padding: 10, gap: 10 },
  heroTitle: { paddingHorizontal: 6, paddingVertical: 2 },
  level: {
    backgroundColor: "#292B4B",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: {
    flexGrow: 1,
    flexBasis: 120,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#101929",
    borderRadius: 12,
    gap: 2,
  },
  progress: {
    backgroundColor: "#26344A",
    height: 4,
    borderRadius: 2,
    marginHorizontal: 5,
  },
  track: { backgroundColor: c.xp, height: 4, borderRadius: 2 },
  progressLabel: { paddingHorizontal: 5, paddingBottom: 2 },
  taskFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  actions: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  menu: { paddingVertical: 0, paddingHorizontal: 12, gap: 0 },
  menuItem: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 3,
  },
  menuDivider: {
    borderTopColor: c.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
export function PagedList({
  table,
  goalId,
}: {
  table: string;
  goalId?: string;
}) {
  const time =
    table === "task_completions"
      ? "completed_at"
      : table === "redemptions"
        ? "redeemed_at"
        : "created_at";
  const q = useInfiniteQuery({
    queryKey: ["local", "paged", table, goalId],
    initialPageParam: null as { time: string; id: string } | null,
    queryFn: ({ pageParam }) =>
      listRows(table, {
        order: time,
        limit: 30,
        before: pageParam || undefined,
        where: goalId ? { goal_id: goalId } : undefined,
      }),
    getNextPageParam: (last) =>
      last.length === 30
        ? { time: last[29][time], id: last[29].id }
        : undefined,
  });
  return (
    <>
      {q.isPending && <Txt muted>读取中…</Txt>}
      {!!q.error && (
        <Card>
          <Txt>数据可能不是最新</Txt>
          <Button title="重试" onPress={() => q.refetch()} />
        </Card>
      )}
      {q.data?.pages.flat().map((r: any) => (
        <Card key={r.id}>
          <Txt size={18}>
            {r.title ||
              r.task_title_snapshot ||
              r.title_snapshot ||
              r.payload?.title ||
              (
                {
                  world_created: "起源星诞生",
                  level_up: "世界升级",
                  building_level: "建筑成长",
                  achievement: "解锁成就",
                } as any
              )[r.kind] ||
              r.type}
          </Txt>
          <Txt muted size={14}>
            {new Date(r[time]).toLocaleString()} ·{" "}
            {r.status || r.period_key || r.kind || ""}
          </Txt>
          {r.amount !== undefined && (
            <Txt color={r.amount > 0 ? c.gold : c.blue}>
              {r.amount > 0 ? "+" : ""}
              {r.amount} ENERGY · 余额 {r.balance_after}
            </Txt>
          )}
          {r.energy_awarded && (
            <Txt color={c.gold}>＋{r.energy_awarded} ENERGY / XP</Txt>
          )}
          {r.energy_spent && <Txt color={c.gold}>−{r.energy_spent} ENERGY</Txt>}
          {["goals", "tasks", "redemptions"].includes(table) && (
            <Button
              quiet
              title="详情"
              onPress={() => router.push(`/${table}/${r.id}`)}
            />
          )}
        </Card>
      ))}
      {q.data && !q.data.pages.flat().length && (
        <Card>
          <Txt muted>尚无记录。每个真实行动都会留下印记。</Txt>
        </Card>
      )}
      {q.hasNextPage && (
        <Button
          title={q.isFetchingNextPage ? "读取中…" : "加载更多"}
          disabled={q.isFetchingNextPage}
          onPress={() => q.fetchNextPage()}
        />
      )}
    </>
  );
}
