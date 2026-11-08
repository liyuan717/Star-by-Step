import React, { createContext, useContext, useEffect, useState } from "react";
import { AppState } from "react-native";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  useQuery,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { localStore, listRows, readRpc } from "./backend";
import { Screen, Txt, Button } from "./ui";
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 0, staleTime: 5000, networkMode: "always" },
    mutations: { networkMode: "always" },
  },
});
const Context = createContext({ ready: false });
export function Providers({ children }: { children: React.ReactNode }) {
  const [ready, R] = useState(false),
    [error, E] = useState("");
  async function open() {
    try {
      await localStore();
      R(true);
      E("");
    } catch (e) {
      E((e as Error).message);
    }
  }
  useEffect(() => {
    void localStore()
      .then(() => R(true))
      .catch((e) => E((e as Error).message));
    const sub = AppState.addEventListener("change", (s) => {
      focusManager.setFocused(s === "active");
      if (s === "active") void client.invalidateQueries();
    });
    return () => sub.remove();
  }, []);
  return (
    <Context.Provider value={{ ready }}>
      <QueryClientProvider client={client}>
        {ready ? (
          children
        ) : (
          <Screen title={error ? "本地数据无法打开" : "正在打开本机世界"}>
            <Txt>{error || "初始化手机SQLite数据库…"}</Txt>
            {!!error && (
              <Button
                title="重试"
                onPress={() => {
                  void open();
                }}
              />
            )}
          </Screen>
        )}
      </QueryClientProvider>
    </Context.Provider>
  );
}
export const useLocalStore = () => useContext(Context);
export function useHome() {
  const { ready } = useLocalStore();
  return useQuery({
    queryKey: ["local", "home"],
    queryFn: () => readRpc("get_home_context"),
    enabled: ready,
    refetchInterval: 30000,
  });
}
export function useRows(table: string) {
  const { ready } = useLocalStore(),
    paged = ["tasks", "goals", "rewards"].includes(table);
  const q = useInfiniteQuery({
    queryKey: ["local", table],
    initialPageParam: null as { time: string; id: string } | null,
    queryFn: ({ pageParam }) =>
      listRows(table, {
        before: pageParam || undefined,
        limit: paged ? 30 : 1000,
      }),
    getNextPageParam: (last) =>
      paged && last.length === 30
        ? { time: last[29].created_at as string, id: last[29].id as string }
        : undefined,
    enabled: ready,
  });
  return { ...q, data: q.data?.pages.flat() };
}
