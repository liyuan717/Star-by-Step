import { Redirect, Tabs } from "expo-router";
import { Text, View } from "react-native";
import { useHome } from "../../providers";
import { c } from "../../ui";
export default function Layout() {
  const home = useHome();

  if (home.data && !home.data.profile?.onboarded_at)
    return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: c.bg,
          borderTopColor: c.border,
          height: 68,
          paddingBottom: 12,
          paddingTop: 6,
        },
        tabBarActiveTintColor: c.blue,
        tabBarInactiveTintColor: c.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      {[
        ["index", "首页", "◈"],
        ["universe", "宇宙", "◎"],
        ["tasks", "任务", "✓"],
        ["rewards", "奖励", "◇"],
        ["profile", "我的", "○"],
      ].map(([name, title, icon]) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarAccessibilityLabel: title,
            tabBarIcon: ({ color, focused }) => (
              <View
                style={{
                  width: 36,
                  height: 27,
                  borderRadius: 9,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: focused ? "#1B3141" : "transparent",
                }}
              >
                <Text
                  style={{ fontSize: 19, color, includeFontPadding: false }}
                >
                  {icon}
                </Text>
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
