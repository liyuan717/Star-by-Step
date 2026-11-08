import { Redirect, useLocalSearchParams } from "expo-router";
import { useHome } from "../providers";
import { Detail } from "../detail";
import { Screen, Txt } from "../ui";
export default function CatchAll() {
  const { screen } = useLocalSearchParams<{ screen: string[] }>();

  const h = useHome();
  if (h.isPending)
    return (
      <Screen title="连接中" loading>
        <Txt>读取本机数据…</Txt>
      </Screen>
    );

  if (!h.data?.profile?.onboarded_at) return <Redirect href="/onboarding" />;
  return <Detail parts={Array.isArray(screen) ? screen : [screen]} />;
}
