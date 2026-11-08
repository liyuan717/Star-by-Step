import { ExpoConfig } from "expo/config";
import { withAndroidManifest } from "expo/config-plugins";
const config: ExpoConfig = {
  name: "ENERGY WORLD",
  slug: "energy-world",
  version: "1.1.3",
  scheme: "energyworld",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  platforms: ["ios", "android"],
  icon: "./assets/icon.png",
  ios: { bundleIdentifier: "dev.energyworld.local", supportsTablet: false },
  android: {
    package: "dev.energyworld.local",
    blockedPermissions: [
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.ACCESS_WIFI_STATE",
    ],
    versionCode: 5,
    adaptiveIcon: {
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundColor: "#080F20",
    },
  },
  plugins: [
    "expo-router",
    "expo-sqlite",
    "expo-sharing",
    [
      "expo-image-picker",
      {
        photosPermission: "选择保存在手机本地的奖励图片。",
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
};
export default withAndroidManifest(config, (c) => {
  const app = c.modResults.manifest.application?.[0];
  if (app) {
    app.$["android:usesCleartextTraffic"] = "false";
    app.$["android:allowBackup"] = "false";
  }
  return c;
});
