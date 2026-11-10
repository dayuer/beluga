---
name: client-ios
description: 客户要的是 iOS 原生 App 时使用:从 templates/ios-app 起工程,每轮改动用 xcrun simctl 在模拟器里构建、安装、启动、截图,截图发回客户。TestFlight 发布另见发布步骤(BLG-23)。
---

# iOS:模拟器自测 → 截图回传

和 client-build-loop 同一套节奏(需求先确认、一轮一个要求、客户说"可以"才打 tag),区别只在"自测 + 截图"这一步用模拟器。客户看不懂代码,他能信任结果的依据是你发回的截图。

前提:Mac 上有 Xcode 和 `xcodegen`(`brew install xcodegen`)。没有就如实告诉客户/用户,不要假装测过。

## 新项目(只做一次)

```bash
mkdir <项目名> && cd <项目名> && git init -b main
cp -r <beluga>/templates/ios-app/. .
mkdir -p docs && cp <需求文件> docs/需求.md
# 改 project.yml:INFOPLIST_KEY_CFBundleDisplayName(应用名)、PRODUCT_BUNDLE_IDENTIFIER
<beluga>/skills/client-ios/sim.sh all        # 首次必须通过再提交
git add -A && git commit -m "初始化:从 ios-app 模板建立"
```

`*.xcodeproj` 和 `build/` 不提交,由 `project.yml` 生成。新增源文件放进 `App/` 即可。

## 每一轮改动

1. 改 `App/` 里的 SwiftUI 代码(需求变了先改 `docs/需求.md` 并让客户确认)。
2. 在工程目录运行 `sim.sh all <截图路径>`:生成工程 → 构建 → 启动模拟器 → 安装 → 启动 → 截图,最后一行输出截图路径。
   - 分步命令:`sim.sh build | install | launch | shot [路径]`。要截多个页面时,先 `all`,再自己操作(`xcrun simctl openurl` 打开深链、或在代码里加启动参数切页面),每个页面 `sim.sh shot <路径>`。
   - `SIM_NAME="iPhone 17"` 选机型;`SETTLE=4` 加长启动后等待;`PROJECT=` 指定工程目录。
   - 构建失败先自己看报错修,最多 3 轮;不行再用选择题告诉客户卡在哪(白话,不贴堆栈)。
3. 看一眼截图(Read 图片)确认是你想要的画面,不是白屏/崩溃/旧版本。
4. **发回客户**:`send_file` 把截图发回聊天,配 2–4 行白话:这轮做了什么、截图里能看到什么、对应哪条验收标准;然后问选择题"可以,这一轮完成 / 要改(请说哪里)"。截图存在 `.beluga/scratch/`,不要提交。
5. 本地提交,客户说"可以"后打 tag(规则同 client-build-loop)。

## 说明与限制

- 模拟器截图是 iPhone 样式的真实渲染,但不等于真机(无相机、推送等)。如实说明。
- 此阶段不签名(`CODE_SIGNING_ALLOWED=NO`),也不上传任何东西。上传 TestFlight 是对外动作,需要用谁的 Apple 开发者账号的决定(BLG-21),且必须先问。

## 自检清单

- [ ] `sim.sh all` 成功,并亲眼看过截图
- [ ] 截图已 send_file 发回,并给了选择题
- [ ] 没提交 `build/`、`*.xcodeproj`、截图
