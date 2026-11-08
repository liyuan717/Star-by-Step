import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { ConfirmAction } from "../src/actions";
import { write } from "../src/backend";
jest.mock("../src/backend", () => ({ write: jest.fn() }));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn().mockResolvedValue(undefined),
  }),
}));
const item = {
  id: "task-id",
  title: "阅读一章",
  category: "study",
  recurrence: "daily",
  version: 1,
  energy_reward: 20,
  estimated_minutes: 15,
};
beforeEach(() => jest.clearAllMocks());
test("请求期间锁定按钮，成功后的继续只关闭弹窗", async () => {
  let finish!: (value: unknown) => void;
  (write as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const close = jest.fn();
  const ui = await render(
    <ConfirmAction kind="task" item={item} onClose={close} />,
  );
  await fireEvent.press(ui.getByRole("button", { name: "确认" }));
  expect(write).toHaveBeenCalledTimes(1);
  await fireEvent.press(ui.getByRole("button", { name: "正在确认…" }));
  expect(write).toHaveBeenCalledTimes(1);
  finish({ completion_id: "one" });
  await waitFor(() => expect(ui.getByText("行动已记录")).toBeTruthy());
  await fireEvent.press(ui.getByRole("button", { name: "继续" }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledTimes(1);
});
test("请求失败显示错误，不显示已获奖励", async () => {
  (write as jest.Mock).mockRejectedValue(Error("结果待确认"));
  const ui = await render(
    <ConfirmAction kind="task" item={item} onClose={jest.fn()} />,
  );
  await fireEvent.press(ui.getByRole("button", { name: "确认" }));
  await waitFor(() => expect(ui.getByText("结果待确认")).toBeTruthy());
  expect(ui.queryByText("行动已记录")).toBeNull();
});
test("余额不足时不能兑换", async () => {
  const ui = await render(
    <ConfirmAction
      kind="reward"
      item={{ id: "r", title: "电影", energy_cost: 100, version: 1 }}
      balance={50}
      onClose={jest.fn()}
    />,
  );
  await fireEvent.press(ui.getByRole("button", { name: "确认" }));
  expect(write).not.toHaveBeenCalled();
});
