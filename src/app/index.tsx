import { Redirect } from "expo-router";
import { useHome } from "../providers";
import { Button, Screen, Txt } from "../ui";
export default function Index() {
  const home = useHome();
  if (home.isPending)
    return (
      <Screen title="正在打开本机世界" loading>
        <Txt>读取手机SQLite数据…</Txt>
      </Screen>
    );
  if (home.error)
    return (
      <Screen title="本地数据无法读取" error={home.error}>
        <Button
          title="重试"
          onPress={() => {
            void home.refetch();
          }}
        />
      </Screen>
    );
  return (
    <Redirect
      href={home.data?.profile?.onboarded_at ? "/(tabs)" : "/onboarding"}
    />
  );
}
