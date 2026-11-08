import { useState } from "react";
import { View } from "react-native";
import {
  Canvas,
  Path,
  Skia,
  Group,
  Circle,
  RoundedRect,
  Rect,
  LinearGradient,
  RadialGradient,
  Line,
  vec,
} from "@shopify/react-native-skia";
import { router } from "expo-router";
import { Button, Card, Txt, c } from "./ui";
import { buildingNames } from "./domain";
const positions: Record<string, [number, number]> = {
  base: [0, 0],
  energy_hub: [2, 0],
  research_lab: [0, 2],
  greenhouse: [-2, 1],
  training_pod: [2, 2],
};
const foot = (key: string) => {
  const [i, j] = positions[key];
  return [(i - j) * 80 + 512, (i + j) * 40 + 310];
};
function polygon(points: number[][]) {
  return Skia.Path.MakeFromSVGString(
    "M " + points.map((v) => v.join(" ")).join(" L ") + " Z",
  )!;
}
export function World({
  buildings = [],
  inventory = [],
  showHint = true,
}: {
  buildings?: { building_key: string; level: number }[];
  inventory?: { virtual_key: string; equipped: boolean }[];
  showHint?: boolean;
}) {
  const [width, W] = useState(320);
  const scale = width / 1024;
  const sorted = Object.keys(positions).sort(
    (a, b) => foot(a)[1] - foot(b)[1] || a.localeCompare(b),
  );
  return (
    <View>
      <View
        onLayout={(e) => W(e.nativeEvent.layout.width)}
        style={{ height: width * 0.69, borderRadius: 14, overflow: "hidden" }}
        accessible={false}
        onTouchEnd={(e) => {
          const x = e.nativeEvent.locationX / scale,
            y = e.nativeEvent.locationY / scale + 28;
          const hit = [...sorted].reverse().find((key) => {
            const [bx, by] = foot(key);
            return Math.abs(x - bx) < 75 && y > by - 180 && y < by + 35;
          });
          if (hit) router.push(`/buildings/${hit}`);
        }}
      >
        <Canvas style={{ flex: 1 }}>
          <Group transform={[{ scale }]}>
            <Rect x={0} y={0} width={1024} height={768}>
              <RadialGradient
                c={vec(515, 420)}
                r={540}
                colors={["#20354E", "#0B1424"]}
              />
            </Rect>
            {Array.from({ length: 36 }, (_, i) => (
              <Circle
                key={i}
                cx={(i * 173 + 31) % 1024}
                cy={(i * i * 29 + 50) % 670}
                r={i % 7 === 0 ? 2.5 : 1.5}
                color={i % 7 ? "#536D91" : "#BDD5F5"}
              />
            ))}
            <Group transform={[{ translateY: -28 }]}>
              {inventory.some((i) => i.virtual_key === "sky" && i.equipped) && (
                <Path
                  path={polygon([
                    [50, 130],
                    [450, 40],
                    [950, 170],
                    [700, 110],
                    [300, 170],
                  ])}
                  color="#71D7B1"
                  opacity={0.25}
                />
              )}
              <Path
                path={polygon([
                  [80, 370],
                  [510, 160],
                  [950, 370],
                  [510, 650],
                ])}
              >
                <LinearGradient
                  start={vec(300, 190)}
                  end={vec(750, 615)}
                  colors={["#2B465E", "#1A2A42"]}
                />
              </Path>
              <Path
                path={polygon([
                  [80, 370],
                  [510, 650],
                  [950, 370],
                  [950, 410],
                  [510, 705],
                  [80, 410],
                ])}
              >
                <LinearGradient
                  start={vec(510, 370)}
                  end={vec(510, 708)}
                  colors={["#15283E", "#10172B"]}
                />
              </Path>
              {Array.from({ length: 7 }, (_, i) => (
                <Line
                  key={i}
                  p1={vec(190 + i * 52, 330 - i * 26)}
                  p2={vec(570 + i * 52, 570 - i * 26)}
                  color="#42627A"
                  strokeWidth={2}
                />
              ))}
              {sorted.map((key, index) => {
                const level =
                  buildings.find((b) => b.building_key === key)?.level || 0;
                const [x, y] = foot(key);
                const height = 50 + level * 28;
                return (
                  <Group key={key}>
                    <Path
                      path={polygon([
                        [x - 80, y],
                        [x, y - 40],
                        [x + 80, y],
                        [x, y + 40],
                      ])}
                      color={level ? "#344C65" : "#15273B"}
                      style={level ? "fill" : "stroke"}
                      strokeWidth={3}
                    />
                    {level > 0 && (
                      <>
                        <Path
                          path={polygon([
                            [x - 49, y - 12],
                            [x - 49, y - height],
                            [x, y - height - 25],
                            [x + 49, y - height],
                            [x + 49, y - 12],
                            [x, y + 12],
                          ])}
                          color={index === 3 ? "#B3E1D6" : "#D9E5F5"}
                        />
                        <Path
                          path={polygon([
                            [x, y - height - 25],
                            [x + 49, y - height],
                            [x + 49, y - 12],
                            [x, y + 12],
                          ])}
                          color="#7896BD"
                        />
                        {Array.from({ length: level + 1 }, (_, n) => (
                          <RoundedRect
                            key={n}
                            x={x - 38}
                            y={y - height + 12 + n * 20}
                            width={30 + index * 3}
                            height={9}
                            r={3}
                            color={index === 3 ? "#71D7B1" : "#58CFFF"}
                          />
                        ))}
                        {level >= 2 && (
                          <>
                            <Line
                              p1={vec(x + 20, y - height - 13)}
                              p2={vec(x + 20, y - height - 48)}
                              color="#D6E6F3"
                              strokeWidth={4}
                            />
                            <Circle
                              cx={x + 20}
                              cy={y - height - 50}
                              r={5}
                              color={c.blue}
                            />
                          </>
                        )}
                        {level === 3 && (
                          <>
                            <RoundedRect
                              x={x - 75}
                              y={y - 63}
                              width={30}
                              height={56}
                              r={6}
                              color="#A9CFE0"
                            />
                            <Line
                              p1={vec(x - 61, y - 52)}
                              p2={vec(x - 61, y - 16)}
                              color={c.blue}
                              strokeWidth={6}
                            />
                            <Circle
                              cx={x}
                              cy={y - height - 20}
                              r={14}
                              color="#FFD479"
                            />
                          </>
                        )}
                      </>
                    )}
                  </Group>
                );
              })}
              {inventory.some(
                (i) => i.virtual_key === "beacon" && i.equipped,
              ) && (
                <>
                  <Line
                    p1={vec(760, 430)}
                    p2={vec(760, 160)}
                    color={c.blue}
                    strokeWidth={5}
                  />
                  <Circle cx={760} cy={430} r={13} color={c.blue} />
                </>
              )}
              {inventory.some(
                (i) => i.virtual_key === "garden" && i.equipped,
              ) &&
                Array.from({ length: 9 }, (_, i) => (
                  <Circle
                    key={i}
                    cx={260 + i * 14}
                    cy={510 + (i % 3) * 15}
                    r={9}
                    color={i % 2 ? c.xp : c.success}
                  />
                ))}
            </Group>
          </Group>
        </Canvas>
      </View>
      {showHint && (
        <Txt muted size={12}>
          点选建筑查看成长条件
        </Txt>
      )}
    </View>
  );
}
export function BuildingList({
  buildings = [],
}: {
  buildings?: { building_key: string; level: number }[];
}) {
  return (
    <Card>
      {Object.keys(positions).map((key) => (
        <Button
          key={key}
          quiet
          title={`${buildingNames[key]} · ${buildings.find((b) => b.building_key === key)?.level ? `Lv.${buildings.find((b) => b.building_key === key)?.level}` : "尚未建设"}`}
          onPress={() => router.push(`/buildings/${key}`)}
        />
      ))}
    </Card>
  );
}
