import net from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const file = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "wsl-tcp.py",
);
const linuxFile =
  "/mnt/" + file[0].toLowerCase() + file.slice(2).replaceAll("\\", "/");
const children = new Set();
for (const [local, remote] of [
  [55321, 54321],
  [55322, 54322],
  [55323, 54323],
  [55324, 54324],
]) {
  const server = net.createServer((socket) => {
    const child = spawn(
      "wsl.exe",
      ["-d", "Ubuntu", "--exec", "python3", linuxFile, String(remote)],
      { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    );
    children.add(child);
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
    const close = () => {
      socket.destroy();
      child.kill();
      children.delete(child);
    };
    child.once("error", close);
    child.once("exit", close);
    socket.once("error", close);
    socket.once("close", close);
    child.stdin.on("error", () => socket.destroy());
  });
  server.on("error", (error) => {
    console.error(`Project port ${local}: ${error.code}`);
    process.exitCode = 1;
  });
  server.listen(local, "127.0.0.1", () =>
    console.log(`Project localhost bridge ${local} -> WSL ${remote}`),
  );
}
process.on("SIGINT", () => {
  for (const child of children) child.kill();
  process.exit(0);
});
