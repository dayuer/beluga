import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(__dirname, "..", "skills", "client-deploy", "handover.sh");
let root: string, proj: string;
const git = (...a: string[]) => execFileSync("git", ["-C", proj, ...a], { stdio: "pipe", encoding: "utf8" });
const env = { ...process.env, GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@b", GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@b" };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ho-"));
  proj = join(root, "demo");
  mkdirSync(proj);
  git("init", "-q", "-b", "main");
  writeFileSync(join(proj, ".gitignore"), "delivery\nnode_modules\n");
  writeFileSync(join(proj, "package.json"), JSON.stringify({ name: "demo", scripts: { build: "mkdir -p dist && echo hi > dist/index.html" } }));
  git("add", "-A");
  git("commit", "-qm", "r1");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("handover.sh", () => {
  it("没有 tag 时拒绝交付", () => {
    expect(spawnSync("bash", [script, proj], { encoding: "utf8", env }).status).toBe(1);
  });
  it("打出含部署包、可克隆的源码 bundle、历史版本和中文交付说明的包", () => {
    git("tag", "-a", "round-1", "-m", "第一版");
    const r = spawnSync("bash", [script, proj], { encoding: "utf8", env });
    expect(r.status, r.stderr).toBe(0);
    const tgz = /PACK_TGZ=(.+)/.exec(r.stdout)![1] as string;
    expect(existsSync(tgz)).toBe(true);
    const dir = tgz.replace(/\.tar\.gz$/, "");
    expect(existsSync(join(dir, "部署包", "部署说明.md"))).toBe(true);
    expect(readFileSync(join(dir, "历史版本.md"), "utf8")).toContain("round-1");
    const doc = readFileSync(join(dir, "交付说明.md"), "utf8");
    expect(doc).toContain("round-1");
    expect(doc).not.toContain("{{");
    const clone = join(root, "clone");
    execFileSync("git", ["clone", "-q", join(dir, "源码", "demo.bundle"), clone]);
    expect(existsSync(join(clone, "package.json"))).toBe(true);
  });
});
