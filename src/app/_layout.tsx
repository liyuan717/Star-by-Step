import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Providers } from "../providers";
import { Screen, Txt, c } from "../ui";
export { ErrorBoundary } from "expo-router";
export default function Layout() {
  return (
    <Providers>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontSize: 15, fontWeight: "700" },
          headerTitle: "ENERGY WORLD",
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </Providers>
  );
}
export function Loading() {
  return (
    <Screen title="正在连接起源星">
      <Txt>读取本机世界中…</Txt>
    </Screen>
  );
}
