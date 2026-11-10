import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(__dirname, "..", "skills", "client-deploy", "pack.sh");
let root: string, proj: string;
const git = (...a: string[]) => execFileSync("git", ["-C", proj, ...a], { stdio: "pipe" });
const commit = (m: string) => git("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", m);
const pack = (...a: string[]) => spawnSync("bash", [script, ...a], { encoding: "utf8" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pack-"));
  proj = join(root, "demo");
  mkdirSync(proj);
  git("init", "-q", "-b", "main");
  writeFileSync(
    join(proj, "package.json"),
    JSON.stringify({ name: "demo", scripts: { build: "mkdir -p dist && echo hi > dist/index.html" } }),
  );
  git("add", "-A");
  commit("i");
  git("tag", "round-1");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("pack.sh", () => {
  it("生成含构建产物、Docker、Nginx、中文说明的包,说明里变量已替换", () => {
    const r = pack("--ref", "round-1", proj, join(root, "out"));
    expect(r.status, r.stderr).toBe(0);
    const p = join(root, "out", "demo-round-1");
    for (const f of ["site/index.html", "Dockerfile", "docker-compose.yml", "docker-compose.https.yml",
      "nginx/default.conf", "nginx/host-nginx.conf.example", ".env.example", "部署说明.md"]) {
      expect(existsSync(join(p, f)), f).toBe(true);
    }
    expect(existsSync(join(root, "out", "demo-round-1.tar.gz"))).toBe(true);
    const doc = readFileSync(join(p, "部署说明.md"), "utf8");
    expect(doc).toContain("demo-round-1");
    expect(doc).not.toContain("{{");
    expect(doc).toContain("HOST_PORT");
  });
  it("未知版本时失败", () => {
    const r = pack("--ref", "nope", proj, join(root, "out"));
    expect(r.status).not.toBe(0);
  });
});
