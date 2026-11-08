import { useState } from "react";
import { Alert, Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as FS from "expo-file-system/legacy";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { localStore, runtime, getPending, readRpc } from "./backend";
import {
  Backup,
  makeBackup,
  parseBackup,
  summary,
  MAX_BACKUP_BYTES,
} from "./local/backup";
import { Card, Button, Txt, c } from "./ui";
export async function exportBackup() {
  if (await getPending()) throw Error("请先恢复待确认的本地操作再备份");
  const store = await localStore();
  const backup = await makeBackup(await store.snapshot(), runtime);
  const text = JSON.stringify(backup);
  const name = `ENERGY_WORLD_${new Date().toISOString().replace(/[:.]/g, "-")}.energyworld.json`;
  if (Platform.OS === "android") {
    const permission =
      await FS.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return null;
    const uri = await FS.StorageAccessFramework.createFileAsync(
      permission.directoryUri,
      name,
      "application/json",
    );
    try {
      await FS.writeAsStringAsync(uri, text);
      await parseBackup(await FS.readAsStringAsync(uri), runtime);
    } catch {
      await FS.deleteAsync(uri, { idempotent: true }).catch(() => {});
      throw Error("备份保存或回读校验失败，请重试");
    }
    return "完整备份已保存到你选择的手机文件夹，包含全部记录和图片。";
  }
  const file = new File(Paths.cache, name);
  file.write(text);
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/json",
      dialogTitle: "保存完整本地备份",
    });
  } finally {
    file.delete();
  }
  return "已打开分享面板，请确认已保存到App以外的文件位置。";
}
export function BackupPanel({ canExport = true }: { canExport?: boolean }) {
  const qc = useQueryClient();
  const [busy, B] = useState(false),
    [message, M] = useState(""),
    [candidate, C] = useState<Backup | null>(null);
  async function run(fn: () => Promise<void>) {
    B(true);
    M("");
    try {
      await fn();
    } catch (e) {
      M((e as Error).message);
    } finally {
      B(false);
    }
  }
  async function choose() {
    C(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/json", "application/octet-stream", "text/plain"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const a = result.assets[0],
      file = new File(a.uri);
    try {
      if ((a.size || file.size) > MAX_BACKUP_BYTES)
        throw Error("备份文件超过96MB上限");
      C(await parseBackup(await file.text(), runtime));
      M("文件格式、校验和、图片、流水和成长对账均通过。尚未覆盖本机数据。");
    } finally {
      if (a.uri.startsWith(Paths.cache.uri)) file.delete();
    }
  }
  async function restore() {
    if (!candidate) return;
    B(true);
    try {
      const checked = await parseBackup(JSON.stringify(candidate), runtime);
      await (await localStore()).replace(checked.payload.tables);
      C(null);
      qc.clear();
      await qc.invalidateQueries();
      router.replace("/");
      Alert.alert(
        "恢复完成",
        "已整体替换本机世界和图片，没有合并或额外发放任何积分。",
      );
    } catch (e) {
      M((e as Error).message);
    } finally {
      B(false);
    }
  }
  function confirm() {
    Alert.alert(
      "确认整体覆盖",
      "现有本机世界会被备份完整替换，无法合并。请先导出现有备份。是否继续？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "确认覆盖",
          style: "destructive",
          onPress: () => {
            void restore();
          },
        },
      ],
    );
  }
  async function check() {
    const r = await readRpc("reconcile");
    M(`对账通过：${r.energy} ENERGY / ${r.xp} XP，共${r.ledger_count}条流水。`);
  }
  const info = candidate ? summary(candidate) : null;
  return (
    <Card>
      <Txt size={22}>本地备份与恢复</Txt>
      <Txt color={c.gold}>
        卸载App或清除应用数据会删除本机世界。请先导出完整备份，并保存到App以外的手机文件夹或自己的存储介质。
      </Txt>
      <Txt muted>
        备份包含个人记录和图片，请自行保管。恢复只支持整体替换，不合并、不叠加资产。
      </Txt>
      {canExport && (
        <Button
          title="导出完整备份（含图片）"
          disabled={busy}
          onPress={() => {
            void run(async () => {
              M((await exportBackup()) || "已取消导出");
            });
          }}
        />
      )}
      <Button
        title="选择本地备份文件"
        quiet
        disabled={busy}
        onPress={() => {
          void run(choose);
        }}
      />
      {info && (
        <>
          <Txt>
            待恢复世界：{info.world} / {info.nickname}
          </Txt>
          <Txt>
            {info.energy} ENERGY · {info.xp} XP · {info.tasks}任务 ·{" "}
            {info.goals}目标 · {info.images}张图片
          </Txt>
          <Txt muted>备份时间：{new Date(info.createdAt).toLocaleString()}</Txt>
          <Txt color={c.danger}>
            确认后将覆盖当前所有记录和图片。重复导入仍是同一份资产，不会增加积分；恢复较早备份会回到当时进度。
          </Txt>
          <Button title="替换本机全部数据" disabled={busy} onPress={confirm} />
          <Button
            title="取消导入"
            quiet
            disabled={busy}
            onPress={() => C(null)}
          />
        </>
      )}
      {canExport && (
        <Button
          title="校验积分与流水"
          quiet
          disabled={busy}
          onPress={() => {
            void run(check);
          }}
        />
      )}
      {!!message && <Txt>{message}</Txt>}
      {busy && <Txt muted>正在本机处理，请稍候…</Txt>}
    </Card>
  );
}
