import { Image } from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import { getRow, localStore, runtime } from "./backend";
import { Txt } from "./ui";
export async function pickMedia(_kind: "avatars" | "rewards") {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
    exif: false,
  });
  if (result.canceled) return null;
  const image = await manipulateAsync(
    result.assets[0].uri,
    [{ resize: { width: 1000 } }],
    { compress: 0.7, format: SaveFormat.JPEG },
  );
  const file = new File(image.uri);
  if (file.size > 2097152) throw Error("图片压缩后仍超过2MB，请选择较小图片");
  const base64 = await file.base64(),
    sha256 = await runtime.hash(base64),
    id = `media/${sha256}.jpg`;
  await (
    await localStore()
  ).write("save_media", { id, mime: "image/jpeg", base64, sha256 });
  return id;
}
export function PrivateImage({
  path,
  avatar = false,
}: {
  path?: string | null;
  avatar?: boolean;
}) {
  const q = useQuery({
    queryKey: ["local", "image", path],
    queryFn: async () => {
      const m = await getRow("media", path!);
      if (!m) throw Error("本机图片不存在");
      return `data:${m.mime};base64,${m.base64}`;
    },
    enabled: !!path,
    staleTime: Infinity,
  });
  if (!path) return null;
  if (!q.data)
    return <Txt muted>{q.error ? "本机图片无法读取" : "图片载入中…"}</Txt>;
  return (
    <Image
      accessibilityLabel={avatar ? "我的头像" : "奖励图片"}
      source={{ uri: q.data }}
      style={
        avatar
          ? { width: 80, height: 80, borderRadius: 40 }
          : { width: "100%", height: 180, borderRadius: 12 }
      }
      resizeMode="cover"
    />
  );
}
