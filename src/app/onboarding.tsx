import { useState } from "react";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, Choices, Field, Screen, Txt } from "../ui";
import { BackupPanel } from "../backup-ui";
import { write } from "../backend";
import { categories, categoryNames } from "../domain";
export default function Onboard() {
  const qc = useQueryClient();
  const [name, N] = useState(""),
    [zone, Z] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    ),
    [focus, F] = useState("other"),
    [busy, B] = useState(false),
    [err, E] = useState("");

  async function finish() {
    B(true);
    try {
      await write("finish_onboarding", {
        nickname: name,
        timezone: zone,
        focus_category: focus,
        create_starter: true,
      });
      await qc.invalidateQueries();
      router.replace("/");
    } catch (e) {
      E((e as Error).message);
    } finally {
      B(false);
    }
  }
  return (
    <Screen title="你好，开拓者" subtitle="为你的起源星设定昵称和时区。">
      <Card>
        <Field label="昵称" value={name} onChangeText={N} />
        <Field label="IANA 时区（保存后锁定）" value={zone} onChangeText={Z} />
        <Txt muted size={13}>
          每日和每周任务按此时区更新。
        </Txt>
        <Choices
          items={categories.map((value) => ({
            value,
            label: categoryNames[value],
          }))}
          value={focus}
          onChange={F}
        />
        <Button title="启程" disabled={busy || !name.trim()} onPress={finish} />
        {!!err && <Txt>{err}</Txt>}
      </Card>
      <BackupPanel canExport={false} />
    </Screen>
  );
}
