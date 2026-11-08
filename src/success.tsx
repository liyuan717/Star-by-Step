import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { Txt, c } from "./ui";
export function SuccessMark() {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    let animation: Animated.CompositeAnimation | undefined;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!reduce && !cancelled) {
        opacity.setValue(0);
        animation = Animated.timing(opacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        });
        animation.start();
      }
    });
    return () => {
      cancelled = true;
      animation?.stop();
    };
  }, [opacity]);
  return (
    <Animated.View style={{ opacity }} accessibilityLabel="操作成功">
      <Txt size={40} color={c.success}>
        ✦
      </Txt>
    </Animated.View>
  );
}
