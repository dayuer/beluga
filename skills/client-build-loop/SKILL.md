---
name: client-build-loop
description: 客户确认 docs/需求.md 之后使用:建项目、从模板起工程、每轮改动都构建 + 浏览器自测 + 手机尺寸截图发回客户,客户说"可以"才打 tag。
---

# 构建 → 自测 → 截图回传

前提:`docs/需求.md` 已被客户明确确认(见 client-clarify)。没确认就不要开始。
客户看不懂代码,**他能信任结果的唯一依据是你发回的截图**。

当前阶段(BLG-8):只在本机预览,不部署,不放任何托管配置。

## 1. 新项目(只做一次)

模板在 Beluga 仓库的 `templates/web-app/`。

```bash
mkdir <项目名> && cd <项目名>
git init -b main
cp -r <beluga>/templates/web-app/. .      # 含 .gitignore
mkdir -p docs && cp <需求文件> docs/需求.md   # 如果需求已在别处
npm install
npx playwright install chromium            # 首次
npm run build                              # 首次构建必须通过再提交
git add -A && git commit -m "初始化:从 web-app 模板建立"
```

- 改 `public/manifest.webmanifest` 和 `index.html` 里的应用名为客户的应用名。
- 客户的 git 库放 GitHub(BLG-9)。**创建远程库、push 属于对外动作:先问客户一句选择题"现在建 GitHub 库吗?(是/稍后)",同意才做。** 本地提交不用问。
- 读 `README.md`:只改它说"该改"的地方。

## 2. 每一轮改动

一轮 = 客户的一个要求(一般对应 `docs/需求.md` 的一两条验收标准)。

1. **改代码**。需求变了先改 `docs/需求.md`,让客户确认。
2. **把冒烟测试改成这轮的流程**:`tests/smoke.spec.ts` 里加/改用例,覆盖本轮验收标准的"点哪里 → 看到什么"。
3. **构建 + 测试**:`npm run build && npm test`。
   - 失败先自己修,最多自己修 3 轮。看报错(`test-results/`),别靠猜;不要为了通过而删断言。
   - 3 轮还不行:用一个选择题告诉客户卡在哪(白话,不贴堆栈),问"简化这个功能 / 再给我一些时间"。
4. **截图**:手机尺寸(390×844)截**这一轮改动涉及的每个页面**,以及主要流程的关键步骤。在测试里 `page.screenshot({ path: 'test-results/<页面>.png' })` 即可,文件名用中文页面名或英文简称。
   - 本机预览链接:`npm run preview`(默认 `http://localhost:4173`,`PORT=…` 可改)。截图不依赖它;链接只对在这台 Mac 上的人有用,别当成客户手机能打开的链接——如实说明。
5. **发回客户**:用 `send_file` 把截图发回聊天,配 2–4 行白话:这轮做了什么、截图里能看到什么、对应哪条验收标准。然后问选择题:
   - 可以,这一轮完成
   - 要改(请说哪里)
6. **本地提交**:`git add -A && git commit -m "第 N 轮:<做了什么>"`。

## 3. 客户说"可以"

- 打 tag:`git tag -a round-N -m "<这一轮>"`(N 从 1 递增)。已 push 的话,问过再 `git push --tags`。
- 把 `docs/需求.md` 里对应的验收标准勾上。
- 客户没说"可以"(沉默、只回"嗯"、问别的):不打 tag,不进入下一轮。
- 客户说"要改":回到第 2 步,仍在同一轮,tag 不变。

## 自检清单

- [ ] 首次构建通过后才做初始提交
- [ ] 本轮 `npm run build && npm test` 都绿
- [ ] 截图是手机尺寸,覆盖改动的页面
- [ ] 截图已 send_file 发回,并给了选择题
- [ ] 只有客户明确"可以"才打 tag
- [ ] 没有推送、没有部署配置,除非客户同意
