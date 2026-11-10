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
# 改 project.yml 的 INFOPLIST_KEY_CFBundleDisplayName(应用名)。Bundle ID/团队 ID 不写文件,由环境变量 BUNDLE_ID/TEAM_ID 传入;模拟器自测不用设
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

# 发布到 TestFlight(客户要装到自己手机上时)

先读 `asc-basics` 和 `testflight-publish` skill。用的是**所有者的 Apple 开发者账号**。脚本:`testflight.sh check | archive | upload`。
**上传、把构建发给测试者都是对外动作:必须先问所有者并得到同意**;没同意就停在 `archive`(本机产出 .ipa)。

## 准备(所有者的事,缺了就告诉他,别自己建)

- 已安装并登录 `asc`;App Store Connect 里已有这个 App(建 App 要先问所有者)→ 得到 `APP_ID`。
- 钥匙串里有该团队的 Apple Distribution 证书 → `TEAM_ID`。**不要自己创建或吊销证书。**
- **Bundle ID 要是真的**:模拟器默认用占位 `local.placeholder.app`,Apple 不会让你注册;发布时必须 `BUNDLE_ID=… ` 传入,`testflight.sh` 遇到 `com.example.*` 等占位值会直接报错。命名用以后可转移的、不绑定个人的反向域名,如 `com.<公司或品牌>.<应用>`,不要用个人名字或临时测试名;一旦上传就别改。
- 版本号改 `project.yml` 的 `MARKETING_VERSION`;构建号由脚本向 asc 要下一个,不能重复。

## 步骤

1. 模拟器自测通过、已提交(上面的流程)。
2. `BUNDLE_ID=… APP_ID=… TEAM_ID=… testflight.sh check` ——只读,确认证书和构建号。
3. `BUNDLE_ID=… APP_ID=… TEAM_ID=… testflight.sh archive` ——签名归档并导出 `build/testflight/export/App.ipa`。签名/描述文件失败:把错误如实告诉所有者,停。
4. 问所有者(选择题):"现在上传这个版本到 TestFlight 吗?(是/稍后)"。同意后:
   `CONFIRM_UPLOAD=yes BUNDLE_ID=… APP_ID=… GROUP="<测试组>" testflight.sh upload`
5. **外部测试链接**:外部测试者需要 Beta App 审核(通常要等),只有所有者同意、并提供审核联系人(以及应用有登录时的演示账号)后才加 `EXTERNAL=yes`。链接在 App Store Connect 的测试组里开启"公开链接"后得到,再用 `asc` 或网页读出,**经所有者确认后**发给客户。
6. 发给客户的话(白话):装 TestFlight → 打开链接 → 接受邀请 → 安装。附上版本号和构建号。

## 交付说明里要写清:App 转移的前提

以后把 App 转给客户自己的开发者账号时(App Store Connect 的 App 转移):

- 转移后 Bundle ID 随 App 走,所以上面强调不要用个人化命名。
- Apple 对转移有限制:例如使用了部分能力(如 iCloud 容器/某些 Apple Pay、关联域名、推送密钥、App Group 等与团队绑定的服务)可能不能直接转,需要先重新配置;有 TestFlight 外部测试进行中、订阅/内购、App 在审核中等情况也有额外要求。具体以 Apple 当时的文档为准,转移前先让所有者核对。
- 证书和描述文件属于旧团队,转移后由新团队重新签发;客户之后自己发布需要自己的开发者账号(付费会员)。

## 自检清单

- [ ] BUNDLE_ID 不是占位值,命名可转移
- [ ] 上传前得到所有者明确同意
- [ ] 外部测试没有未经同意就提交审核
- [ ] 交付说明写了转移前提
