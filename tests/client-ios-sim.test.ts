import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const sim = join(root, "skills", "client-ios", "sim.sh");
const has = (c: string) => spawnSync("which", [c]).status === 0;
const canRun = process.platform === "darwin" && has("xcodebuild") && has("xcodegen") &&
  /iPhone/.test(spawnSync("xcrun", ["simctl", "list", "devices", "available"], { encoding: "utf8" }).stdout ?? "");
const tmp = mkdtempSync(join(tmpdir(), "ios-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("client-ios", () => {
  it("没有子命令时给出用法并失败", () => {
    const r = spawnSync("bash", [sim], { encoding: "utf8", cwd: root });
    if (process.platform !== "darwin") return;
    expect(r.status).not.toBe(0);
  });

  it.skipIf(!canRun)("模板工程能构建、在模拟器里启动并截图", () => {
    const proj = join(tmp, "app");
    cpSync(join(root, "templates", "ios-app"), proj, { recursive: true });
    const shot = join(tmp, "shot.png");
    const r = spawnSync("bash", [sim, "all", shot], { encoding: "utf8", cwd: proj, env: { ...process.env, PROJECT: proj } });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(shot) && statSync(shot).size > 10000).toBe(true);
  }, 400_000);
});

describe("testflight.sh", () => {
  const tf = join(root, "skills", "client-ios", "testflight.sh");
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync("bash", [tf, ...args], { encoding: "utf8", cwd: tmp, env: { ...process.env, PROJECT: tmp, ...env } });

  it("没有 CONFIRM_UPLOAD=yes 时拒绝上传", () => {
    const r = run(["upload"], { APP_ID: "1", GROUP: "g" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("先问所有者");
  });

  it("check 缺 APP_ID/TEAM_ID 时给出明确提示", () => {
    const r = run(["check"], { PATH: `${tmp}/bin:/usr/bin:/bin` });
    expect(r.status).not.toBe(0);
  });

  it.each(["com.example.app", "local.placeholder.app", "example.foo"])("check 拒绝占位 Bundle ID %s 并说明设置方法", (id) => {
    const r = run(["check"], { BUNDLE_ID: id, APP_ID: "1", TEAM_ID: "T" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("占位值");
    expect(r.stderr).toContain("BUNDLE_ID=com.");
  });

  it("check 没设 BUNDLE_ID 时提示怎么设", () => {
    const env: Record<string, string | undefined> = { ...process.env, PROJECT: tmp };
    delete env.BUNDLE_ID;
    const r = spawnSync("bash", [tf, "check"], { encoding: "utf8", cwd: tmp, env });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("请设 BUNDLE_ID");
  });

  // PATH="/usr/bin:/bin" has no bash on Windows: the script is for Macs anyway.
  it.skipIf(process.platform === "win32")("真实 Bundle ID 能通过占位检查(之后才因缺工具/证书失败)", () => {
    const r = run(["check"], { BUNDLE_ID: "com.acme.shop", PATH: "/usr/bin:/bin" });
    expect(r.stderr).not.toContain("占位值");
  });
});
