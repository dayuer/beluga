import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(__dirname, "..", "skills", "client-deploy", "versions.sh");
let root: string, proj: string, shot: string;
const git = (...a: string[]) => execFileSync("git", ["-C", proj, ...a], { stdio: "pipe", encoding: "utf8" });
const commit = (m: string) => git("-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qam", m);
const v = (...a: string[]) =>
  spawnSync("bash", [script, ...a], { encoding: "utf8", env: { ...process.env, PROJECT: proj, GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@b", GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@b" } });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ver-"));
  proj = join(root, "demo");
  mkdirSync(proj);
  git("init", "-q", "-b", "main");
  writeFileSync(join(proj, ".gitignore"), "delivery\nnode_modules\n");
  writeFileSync(join(proj, "package.json"), JSON.stringify({ name: "demo", scripts: { build: "mkdir -p dist && cp v.txt dist/index.html" } }));
  writeFileSync(join(proj, "v.txt"), "one");
  git("add", "-A");
  commit("r1");
  shot = join(root, "s.png");
  writeFileSync(shot, "png");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("versions.sh", () => {
  it("检查点建 tag、打包、存截图;列表显示;回退给出旧版包和说明并可恢复源码", () => {
    expect(v("checkpoint", "round-1", shot).status).toBe(0);
    writeFileSync(join(proj, "v.txt"), "two");
    writeFileSync(join(proj, "new.txt"), "n");
    git("add", "-A");
    commit("r2");
    expect(v("checkpoint", "round-2").status).toBe(0);

    const list = v("list").stdout;
    expect(list).toContain("round-1");
    expect(list).toContain("1 张");
    expect(list.indexOf("round-2")).toBeLessThan(list.indexOf("round-1"));

    const r = v("rollback", "round-1", "--git");
    expect(r.status, r.stderr).toBe(0);
    const d = join(proj, "delivery", "versions", "round-1");
    expect(readFileSync(join(d, "回退说明.md"), "utf8")).toContain("round-1");
    expect(readFileSync(join(d, "demo-round-1", "site", "index.html"), "utf8")).toContain("one");
    expect(readFileSync(join(proj, "v.txt"), "utf8")).toBe("one");
    expect(existsSync(join(proj, "new.txt"))).toBe(false);
    expect(git("log", "-1", "--format=%s").trim()).toBe("回退到 round-1");
    expect(existsSync(d)).toBe(true); // delivery 未被清掉
  });
  it("未知版本和非法版本名都失败", () => {
    expect(v("rollback", "nope").status).not.toBe(0);
    expect(v("checkpoint", "../x").status).not.toBe(0);
  });
});
