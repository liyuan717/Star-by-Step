import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
export const c = {
  bg: "#0B111D",
  card: "#141E2F",
  border: "#25334A",
  blue: "#8ADFE6",
  gold: "#F4CB80",
  xp: "#AFA8FF",
  text: "#F2F5FC",
  muted: "#ACB9CD",
  danger: "#FF7A88",
  success: "#71D7B1",
};
export function Txt({
  children,
  muted = false,
  color,
  size = 16,
  strong = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
  color?: string;
  size?: number;
  strong?: boolean;
}) {
  return (
    <Text
      style={{
        color: color || (muted ? c.muted : c.text),
        fontSize: size,
        lineHeight: size * 1.4,
        fontWeight: strong ? "700" : "400",
      }}
    >
      {children}
    </Text>
  );
}
export function Button({
  title,
  onPress,
  disabled = false,
  quiet = false,
  compact = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  quiet?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: compact ? 44 : 48,
        borderRadius: 12,
        paddingVertical: compact ? 8 : 11,
        paddingHorizontal: 13,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: quiet ? "#1B293D" : c.blue,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          fontSize: compact ? 14 : 15,
          fontWeight: "600",
          color: quiet ? c.text : c.bg,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}
export function Field({
  label,
  value,
  onChangeText,
  secure = false,
  numeric = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  secure?: boolean;
  numeric?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Txt muted size={14}>
        {label}
      </Txt>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        keyboardType={numeric ? "number-pad" : "default"}
        autoCapitalize="none"
        multiline={multiline}
        placeholderTextColor={c.muted}
        style={styles.input}
      />
    </View>
  );
}
export function Choices({
  items,
  value,
  onChange,
  segmented = false,
}: {
  items: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
  segmented?: boolean;
}) {
  return (
    <View style={segmented ? styles.segmented : styles.chips}>
      {items.map((i) => (
        <Pressable
          key={i.value}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === i.value }}
          onPress={() => onChange(i.value)}
          style={{
            minHeight: 44,
            flex: segmented ? 1 : undefined,
            paddingHorizontal: 10,
            paddingVertical: 8,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 10,
            backgroundColor:
              value === i.value
                ? "#22384A"
                : segmented
                  ? "transparent"
                  : c.card,
          }}
        >
          <Txt color={value === i.value ? c.blue : c.muted} size={14}>
            {i.label}
          </Txt>
        </Pressable>
      ))}
    </View>
  );
}
export function Screen({
  title,
  subtitle,
  children,
  refresh,
  loading,
  error,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  refresh?: () => void;
  loading?: boolean;
  error?: unknown;
}) {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: c.bg }}
      edges={["top", "left", "right"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.screen}
          refreshControl={
            refresh ? (
              <RefreshControl
                refreshing={!!loading}
                onRefresh={refresh}
                tintColor={c.blue}
              />
            ) : undefined
          }
        >
          <View style={styles.header}>
            <Txt size={27} strong>
              {title}
            </Txt>
            {subtitle && (
              <Txt muted size={14}>
                {subtitle}
              </Txt>
            )}
          </View>
          {loading && (
            <Card>
              <ActivityIndicator color={c.blue} />
              <Txt muted>正在读取本机数据…</Txt>
            </Card>
          )}
          {!!error && (
            <Card>
              <Txt color={c.danger}>
                {error instanceof Error ? error.message : "读取失败"} ·
                数据可能不是最新
              </Txt>
              {refresh && <Button title="重试" onPress={refresh} quiet />}
            </Card>
          )}
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 32,
    gap: 16,
  },
  header: { gap: 3, marginBottom: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  segmented: {
    flexDirection: "row",
    gap: 3,
    backgroundColor: c.card,
    borderRadius: 13,
    padding: 4,
  },
  card: {
    backgroundColor: c.card,
    borderRadius: 18,
    padding: 15,
    gap: 9,
    borderWidth: 1,
    borderColor: c.border,
  },
  input: {
    color: c.text,
    fontSize: 16,
    minHeight: 48,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: c.bg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
});
