# Synon Studio 手机全流程走查（A10）

> 范围：`packages/studio-app` 的 P1–P12。对照的“设计稿”以仓库里的契约为准：
> `docs/studio-ui.md` §4 / §6.1（手机全流程与交互）、`docs/studio-mobile-ux.md`（`UX-*` 可检查项）、
> `docs/studio-app-screens.md`（M5 四屏版式）、`docs/studio-plan-page.md`（计划页、验收、退回）。
> Claude Design 画布「Synon Studio 工作台 › 手机 全流程」与这些文档一致；画布本身不在仓库里。

## 0. 走查环境

| 项 | 值 |
|---|---|
| 设备 | iPhone 16 Pro 模拟器（iOS 26.5，402×874pt，3x） |
| 语言 | 简体中文 |
| 数据 | `e2e/run.mjs` 的假中台 + 假 daemon（`e2e/fixtures/views.ts`），以及 `artifacts/` 里的演示包 |
| 截图 | 每屏一张或多张，存在任务里；本文件只记差异与决定 |
| 真机 | iPhone（Yuqing’s iPhone）与 Android 真机（NX733J）在 A0 时都因锁屏未完成；本次先按同一套流程在模拟器走查，真机解锁后照着重跑 |

走查脚本：`packages/studio-app/e2e/maestro/shots-p1-p4.yaml`、`shots-p5-p8.yaml`、`shots-p9-p12.yaml`、
`states.yaml`（异常状态）。它们都用 `e2e/run.mjs` 驱动，截图落在 `e2e/out/<时间>/…/takeScreenshot/`。

## 1. P1 登录

对照：`docs/studio-app-screens.md` §1.1、`docs/studio-mobile-ux.md` UX-03/UX-07/UX-20/UX-26。

| 检查 | 结果 |
|---|---|
| 品牌方块 56、`登录` 24/700、一句说明 | 一致 |
| 邮箱框贴 ActionDock 上方（拇指区），主按钮 52 | 一致 |
| 全屏只有一个实底按钮 | 一致（已发送态为「打开邮箱」） |
| 发送后回执面板、按钮仍可点 | 一致 |

差异与决定：

- **已发送态多了一个「打开邮箱」主按钮**（规范只写了「再发一封」）。决定：保留；它把“下一步做什么”说清楚了，仍只有一个实底按钮，「再发一封」是文字按钮。

## 2. P2 提需求（新需求）

对照：`docs/studio-ui.md` §2.4、`docs/studio-app-screens.md` §4、UX-03/UX-04/UX-16/UX-17。

| 检查 | 结果 |
|---|---|
| 新需求 / 对做好的提意见两个分段 | 一致 |
| 项目选择、输入框、语音、拍照/相册、设计稿包 | 一致（画布与 `studio-ui.md` §4 的新增入口） |
| 平台 2×2、选中描边 + 勾 | 一致 |
| 目标为空或未选平台时主按钮禁用 | 一致 |
| 滚动到底时内容不被 ActionDock 遮挡（UX-17） | 一致（新增项目选择与附件后，平台选择落在首屏折叠线以下；上滑后完整可见、可点） |

差异与决定：

- **平台选择在首屏折叠线以下**（402×874）。规范 390 版式里它整块在 ActionDock 上方；实际多了项目选择、附件与语音后放不下。决定：保留滚动，不压缩间距；主输入框与主按钮仍在拇指区，符合 UX-03。
- **主按钮禁用时文字对比度 3.82:1**（`text3` 在 `disabledFill` 上），低于 UX-21 的 4.5:1。已修为 `text2`（5.30:1），并加单测。

## 3. P3 回答问题

对照：`docs/studio-ui.md` §2.2（卡片流里的问题卡）、`docs/studio-mobile-ux.md` §10.3、UX-20/UX-21。

| 检查 | 结果 |
|---|---|
| 一题一题、编号、选项、自己写 | 一致 |
| 未选完时提交禁用、「还差 N 题」 | 一致 |
| 选项是整行、命中区足够大 | 一致 |

差异与决定：

- **问题用内联卡片，不再用 `studio-plan-page.md` §4.10 的底部决策抽屉**。决定：以 `studio-ui.md` §2.2 的卡片流为准；§4.10 的抽屉描述视为已被 A4b 卡片流取代。
- 步骤条（当前进度）是分段色条：完成绿、进行中蓝、等待斜纹。颜色有含义，不新增 token。决定：保留。

## 4. P4 需求详情


对照：`docs/studio-ui.md` §2.2 / §4、`docs/studio-plan-page.md` §4（内容搬进对话区）、UX-17/UX-20。

| 检查 | 结果 |
|---|---|
| 标题栏（返回 / 需求标题 / 结果与计划） | 一致 |
| 状态行（圆点 + 一句话）+ 结果入口 | 一致 |
| 步骤条卡、需求对话、输入条 | 一致 |
| 滚动到底不被输入条遮挡 | 一致 |

差异与决定：

- **状态行放在正文顶部的状态条卡片里**，标题栏只放标题与结果入口；设计文档 §2.2 画的是“标题 · 状态行”同一行。决定：保留（状态条更醒目，结果入口也更好点）。

## 5. P5 交付验收卡

对照：`docs/studio-plan-page.md` §4.11、`docs/studio-ui.md` §2.2（验收卡）、UX-20/UX-21。

| 检查 | 结果 |
|---|---|
| 第 N 轮交付、等你验收 | 一致 |
| 验收标准列表 | 一致（本次补上） |
| 怎么看（运营方的验收说明） | 一致 |
| 还不行…（左）/ 通过（右） | 一致，命中区 ≥44 |
| 没有设备密钥时通过禁用并说明去哪儿加设备 | 一致 |

差异与决定：

- **卡片流的交付卡原先没有验收标准**，只有“怎么看”和轮次；设计 `§4.11` 与 P1 设计图 `09-accept-card` 都把标准列表放在标题下。已修：交付卡带上 `criteria`，`AcceptCard` 在“怎么看”之前列出。旧数据没有这个字段时是空数组，不报错。

## 6. P6 交付流转与预览

对照：`docs/studio-app-screens.md` §0.4、`docs/studio-ui.md` §2.3（结果区四页签）、UX-20。

| 检查 | 结果 |
|---|---|
| 交付卡上的“打开体验版 / 下载安装包” | 一致 |
| 代码卡：仓库、合并请求、已推送 | 一致 |
| 结果抽屉的“预览”页签：测试环境就绪、在浏览器中打开、下载安装包 | 一致 |

差异与决定：

- **入口与抽屉名字不一致**：状态条上的入口写“结果与计划”，抽屉标题写“结果与详情”。已统一为“结果与详情”。
- **真实中台还没有 preview/artifacts 字段**，这一屏用演示数据（`lib/demo/screens.ts`）走查；等 `studio-hub` 补上后再按真实链路回看。决定：先按演示数据验收版式。
- 截屏时深链刚跳转完，第一版截到了转场中间帧；走查脚本加了 `waitForAnimationToEnd`。

## 7. P7 原因抽屉

对照：`docs/studio-plan-page.md` §4.11、`docs/studio-ui.md` §6.1（带「…」的按钮先问原因）。

| 检查 | 结果 |
|---|---|
| 标题「哪里还不行？」、三个快捷标签 | 一致 |
| 至少 10 个字，不足时提示还差几个字 | 一致 |
| 退回给工作室是唯一实底按钮 | 一致 |

差异与决定：

- **点快捷标签后接着打字会粘成一个词**（“和我说的不一样第二个提醒…”）。已修：标签后补一个“；”分隔。
- **空输入时提示“还差 10 个字（至少 10 个字）”**，重复且绕。按 `§4.11` 改成“再多写一点（至少 10 个字）”。

## 8. P8 待办

对照：`docs/studio-plan-page.md` §6、`docs/studio-ui.md` §4（底部三个页签）。

| 检查 | 结果 |
|---|---|
| 顶部标题「待办」+ 刷新 | 一致 |
| 「要你做的」分组，卡片带项目、说明与动作 | 一致 |
| 底部三个页签，待办带计数 | 一致 |
| 「在等待，你不用做什么」分组 | 本状态没有等待项；由异常状态走查（SS-95）覆盖 |

差异与决定：

- 待办卡片的标题与项目名相同时（测试数据里标题就叫“饮水打卡”），看起来像重复；真实数据里需求标题通常不同。决定：不改版式。

## 9. P9「我」和它的子页

对照：`docs/studio-ui.md` §3（设置）、§4（「我」是设置的手机版）、UX-20/UX-27。

| 页面 | 检查结果 |
|---|---|
| 我 | 账号卡 +「项目与运行」「设备与账号」两组，右值摘要（2 个项目 / 只读 / 1/2 台在线 / 2 台已登记 / 已开启） |
| 账号与通知 | 语言（中文 / English）、外观（浅色 / 深色 / 跟随系统）、推送开关、退出登录、删除账号（禁用并说明在桌面做） |
| 环境与密钥 | 只读列表，页脚说明在桌面上填和换 |
| 执行机器 | 汇总行 + 每台机器的在线/接单状态与本月用量环；离线机器写“等待” |
| 设备 | 表格（设备 / 类型 / 登记时间）、“这台”徽标、加一台设备；没有签名密钥时移除禁用并说明 |
| 项目与代码交付 | 两个项目、运行方式与代码交付模式 |

差异与决定：

- **设备的「移除」画在非本机那一行的下方、独占一行**，容易被读成整张表的动作。决定：保留（当前行没有移除，且受限时有说明）；真机走查时如仍觉得歧义，再改成行内右侧。
- 删除账号在手机上不做，只给一句去桌面操作的说明；与 `studio-ui.md` §3「删除账号（会话）」不冲突，是移动端的取舍。

## 10. P10 批准开工卡与批准改动卡

对照：`docs/studio-ui.md` §2.2、`docs/studio-plan-page.md` §2 / §4.12、§6.1（带「…」的按钮先问原因）。

| 检查 | 结果 |
|---|---|
| 开工卡：步骤数、大约多久、怎么做、什么时候开始、开始做 | 一致 |
| 开工卡是唯一实底按钮，无密钥时禁用并说明 | 一致 |
| 改动卡：+新增 ~修改 −移除、先不改… / 按这个改 | 一致 |
| 等待卡：暂时在等待、原因与“你不用做什么” | 一致 |

差异与决定：

- **开工 Gate 已升起时仍显示带「对，就是这样」的理解卡**，客户已确认过，会误导。已修：`request-view` 在 Gate pending 时不再生成理解卡，并补单测。
- 改动状态下卡片流下方还有一条「放弃改动」文字动作，与改动卡里的「先不改…」重复。决定：保留（一个是卡片动作，一个是页面级逃生口），不额外加确认。

## 11. P11 批准上线卡

对照：`docs/studio-ui.md` §6.1（不可逆才二次确认）、`docs/studio-env.md`、UX-20。

| 检查 | 结果 |
|---|---|
| 上线到正式环境、要上的版本 / 线上版本、上次上线时间与人 | 一致 |
| 上线是唯一实底按钮，无密钥时禁用并说明 | 一致 |

差异与决定：无。

## 12. P12 结果抽屉

对照：`docs/studio-ui.md` §2.3（结果区四页签）、UX-17/UX-20。

| 页签 | 检查结果 |
|---|---|
| 成果 | 按轮次分组：在线预览、安装包、你提供的资料 |
| 改动 | 新增 / 修改 / 移除；没有改动时是空态说明 |
| 计划 | 图 / 大纲 / 动态三个子页签 |
| 预览 | 测试环境就绪、在浏览器中打开、下载安装包；没有预览时说明何时会有 |

差异与决定：

- 页签名用「成果」「改动」，设计文档 §2.3 写的是「产物」「变更」。决定：保留既有用词（客户更熟），文档措辞随后续统一。
- 抽屉从底部拉起，55% 高，把手可拖；关闭按钮 44×44。一致。

## 13. 读屏（VoiceOver / TalkBack）

做法：模拟器里打开旁白（`xcrun simctl spawn <udid> defaults write com.apple.Accessibility VoiceOverTouchEnabled -bool true`），再启动 App。
自动化的单指点击只能移动旁白的焦点、不能代替「双击激活」，所以这条主流程分两层验收：

1. **名字与角色**：`packages/studio-app/lib/a11y.test.ts` 扫全部组件与路由，断言每个 `<Pressable>`
   都有 `accessibilityRole`，并且要么有 `accessibilityLabel`、要么元素里有文字。当前 0 处缺失。
2. **状态变化会被读出**：同一测试断言 `card/Card`、`StatusDot`、`SyncBanner`、`ReceiptLine`、`UndoBar`、
   `InlineHint` 都带 `accessibilityLiveRegion="polite"`；`ReasonSheet` 的「还差 N 个字」、`PrimaryButton`
   的错误行、`GoalInput` 的语音提示也各自有 polite 区域与单测。

各屏此刻读出来的名字：

| 屏 | 旁白读什么 |
|---|---|
| P1 登录 | 「Synon Studio」标题、登录、说明、邮箱（输入框）、继续（按钮）；已发送时有「已发送登录链接」与邮箱 |
| P2 提需求 | 返回、新需求、分段（新需求 / 对做好的提意见）、项目（单选，选中态）、你想做什么（输入框）、语音、拍照、从相册选、设计稿包、每个平台（按钮，读出已选/未选）、开始规划（禁用时读出禁用） |
| P3 回答问题 | 状态圆点（等你）、问题卡标题、每题与每个选项（单选）、一起提交（禁用）、“还差 N 题” |
| P4 需求详情 | 返回、需求标题、结果与详情（按钮）、状态行、步骤格（第 i 步，状态）、对话气泡、说点什么（输入框）、发送 |
| P5 交付验收卡 | 第 N 轮交付、等你验收、验收标准、怎么看、还不行…、通过（无密钥时读出禁用，旁边有原因） |
| P6 交付与预览 | 打开体验版、下载安装包、仓库/合并请求、结果抽屉四个页签（已选态）、关闭 |
| P7 原因抽屉 | 哪里还不行？、三个快捷标签、输入框、还差 N 个字（会朗读）、退回给工作室 |
| P8 待办 | 待办页签（已选，带计数）、每张卡的项目/标题/说明、通过、还不行… |
| P9 我 | 各组标题与每行（行读出名称与右侧摘要）、推送开关（开/关）、语言与外观（选中态） |
| P10–P11 | 卡片标题与状态（等你确认开工 / 等你批准上线，状态变化会朗读）、开始做 / 按这个改 / 上线（无密钥时禁用并读原因） |
| P12 结果抽屉 | 四个页签（已选态）、每一条成果与资料、关闭 |

发现并修掉：

- **抽屉的遮罩只有名字没有角色**（`Drawer.tsx` 的 scrim）：补 `accessibilityRole="button"`，旁白才会说“按钮，关闭”。

真机（iPhone）仍锁屏，未能在真机上再走一遍；解锁后用同一套检查重跑即可。

## 14. 异常状态逐个过

走查脚本：`e2e/maestro/states-demo.yaml`（演示数据，iPhone 15 Pro Max 模拟器）、
`e2e/maestro/states-real.yaml`（假中台 + 假 daemon，iPhone 16 Pro 模拟器）。截图在任务里。

| 状态 | 怎么造 | 看到的 |
|---|---|---|
| 客户断网 | `/hub/offline` 代理断网后切回「需求」页 | 顶部 `SyncBanner`「你已离线 · 上次同步 x 分钟前」，列表保留缓存；琥珀色 |
| 工作室离线 | 停掉假 daemon 后重新进需求 | 顶部横幅「工作室离线 · 上次同步 x 分钟前」；灰点、等待措辞 |
| 排队 | 推 `awaitingStart` 视图 | 「暂时在等待 · 前面还有任务在排队」「轮到后会自动继续」；灰点 |
| 用量已满 | 演示数据 `req-quota`（`wait.card.reason=quota`） | 「这个月的用量已满，下个月 1 日恢复」「你不需要做什么」；灰点 |
| 需要人 | 演示数据 `req-human`（`needs-human`） | 「需要人看一下，我们已经在处理」「处理好后会自动继续」；灰点 |
| 空列表 | `/?state=empty` | 「还没有需求」+ 一句说明 +「提需求」前进一步 |
| 加载中 | `/?state=loading` | 静态骨架行，没有整屏 spinner |
| 签名被拒 | 见下 | 没有可靠的真机触发点；用「这台设备还没有登记密钥」的禁用态与单测覆盖 |
| 上传中断 | 演示数据 `req-upload`（设计稿卡 42%） | 「上传中 42%」+ 进度条；断网时停在同一个百分比，恢复后自己续传 |

红色只留给客户能亲手修的事：以上九种里，断网、离线、排队、用量、需要人全是灰/琥珀；
红色的例子仍是「正式环境交付令牌已过期 · 需要你处理」与注册页的网络失败（客户自己能重连）。

差异与决定：

- **用量已满 / 需要人 的等待卡在真实链路里到不了**：`StudioPlanView` 只有
  `waitingOn: customer | studio | ai`，没有用量/需要人的原因；卡片与文案已就绪。
  走查用演示数据把这两种状态画出来，离线的原因映射等中台补字段。决定：记在这里，等 `studio-hub` 协议。
- **签名被拒**：假 daemon 的 `/reset` 只清视图、不清设备信任表，无法制造拒绝；也没有别的界面能让客户自己造成拒绝。
  拒绝文案（未登记设备 / 坏签名 / 时钟）由 `lib/strings/sign.ts` 的单测覆盖，真机截图用「没有设备密钥」的禁用态代替。
- 为了能从深链打开演示态，`lib/links.ts` 的 `/request/:id` 与根路径现在保留已知的 `?state=`
  （`normal|empty|loading|offline|runnerOffline`）；非 demo 构建不读这个参数。补了单测。

## 15. 读屏：TalkBack（Android）

Android 真机（NX733J）与 Android 模拟器（AOSP android-35）都没有预装 TalkBack；Play 商店与
google_apis 镜像在这台机器上装不下来（下载停在 29%）。所以这一节做的是**无障碍树检查**：

- 脚本：`.beluga/scratch/android-a11y.mjs <serial>`（`uiautomator dump`，找可点击且没有名称的节点）。
- 结果（Android 模拟器，demo 构建）：需求列表 16 个可点、详情 11 个、待办 14 个、我 9 个、
  账号与通知 6 个，**没有名字的都是 0**。名字来自 `content-desc` 或文字本身，与 iOS 的
  `accessibilityLabel` 是同一套组件。
- 状态变化：卡片状态、状态点、离线横幅、回执与撤销条在 iOS 与 Android 共用同一个组件，
  Android 上对应 `accessibilityLiveRegion="polite"` 的无障碍事件。

TalkBack 本身（语音朗读与手势）还没有走：`e2e/maestro/talkback.yaml` 已就绪（单击聚焦、
双击激活、带截图），装好 TalkBack 后用
`adb shell settings put secure enabled_accessibility_services com.google.android.marvin.talkback/.TalkBackService`
打开再跑。手机上的 TalkBack 需要用户自己从 Play 商店安装（本机无法代装）。



## 16. 补拍：两档尺寸、子状态、链接过期、指纹（SS-232）

脚本：`e2e/maestro/shots-sizes.yaml`（两档尺寸，用 `e2e/run.mjs` 的真中台 + 假 daemon）、
`e2e/maestro/shots-states.yaml`（真中台子状态）、`e2e/maestro/shots-states-demo.yaml`
（`EXPO_PUBLIC_DEMO=1` 才能到的假数据状态）。截图都落在 `.beluga/scratch/ss-232/`。

屏幕尺寸：iPhone 14（390×844）与 iPhone SE（3rd gen，375×667）。**320×568 建不出来**：
iOS 26.5/27.2 已不支持 4 英寸设备类型，`simctl create` 报 `Incompatible device`；
SE 3rd gen 是这台机器上能建的最小尺寸，用它当小屏档。

| 任务 | 截图（`.beluga/scratch/ss-232/`） | 结果 |
|---|---|---|
| SS-16 键盘不挡输入框与主按钮 | `size-login-keyboard-390.png`、`size-login-keyboard-375.png` | 两档键盘弹起时邮箱框与「继续」都完整可见 |
| SS-24 三页签不被安全区挡 | `size-requests-tabs-{390,375}.png`、`size-todo-tabs-{390,375}.png`、`size-me-tabs-{390,375}.png` | 三页签都在底部安全区之上 |
| SS-27 三种动作排法 | `state-action-row-start.png`（只有主动作）、`state-action-row-understanding.png`（主 + 否定）、`state-action-row-accept.png`（主 + 否定 + 「由这台设备确认」） | 三种都拍到；说明行在动作行下方整行折行 |
| SS-28 主按钮三态 | idle 见上面各卡；working / done 见「补拍时发现的问题」 | **不能静态截屏**：所有调用方只传 idle / working，working 只在一次发送往返里（< 1 秒），done 没有任何调用方。三态由 `components/PrimaryButton.test.tsx` 覆盖 |
| SS-33 每种等待原因 | `state-wait-queued.png`（真中台排队）、`state-wait-quota.png`、`state-wait-human.png`、`state-wait-offline.png`（demo） | 四种原因齐全，都带「什么时候会好」 |
| SS-37 登录三态 | `size-login-idle-390.png`（发送）、`state-login-sent.png`（已发送）、`state-login-expired.png`（链接已失效，红色原地提示） | 三态都拍到；点邮件链接回 App 的联合验收仍留给真机（SS-240） |
| SS-46 设计稿卡与代码卡 | `state-design-uploading.png`（42%）、`state-design-received.png`（已收下 18 个文件）、`state-code-failed.png`（推送失败，红点） | 三态拍到；**推送失败卡没有「重新推送」按钮**（见问题 1） |
| SS-48 计划页签三档 | `state-plan-map.png`、`state-plan-outline.png`、`state-plan-activity.png` | 图 / 大纲 / 动态都拍到 |
| SS-51 预览三态 | `state-preview-ready.png`（demo，有测试环境地址与安装包）、`state-preview-unconfigured.png`（真中台，没有预览地址的原地说明） | **「部署中」到不了**（见问题 2） |
| SS-72 指纹两态 | `state-fingerprint-match.png`、`state-fingerprint-mismatch.png` | 一致（4 组短码 + 登记）与不一致（红框 + 暂停登记 + 重新核对）都拍到 |

### 补拍时发现的问题（本次不改界面）

1. **代码卡推送失败没有重试入口**：`components/cards/CodeCard.tsx` 只在调用方传 `onRetryPush`
   时才画「重新推送」，而 `CardStream` 没有传（`state-code-failed.png` 里只有红点「推送失败」）。
   SS-242 查过协议：`StudioAction` 与 `SIGNED_ACTION_KINDS` 里都没有重新推送 / code push 这类动作
   （只有 plan.create、chat.send、plan.verify、plan.requestStart、decision.answer、milestone.pass /
   sendBack、draft.apply / discard，以及签名的 request.confirm、gate.answer、delivery.accept、
   release.approve、device.remove）。按 SS-242 的约定**不发明协议**，这一项记为「不适用：协议无重新
   推送」；等协议加了动作再在 `request/[id].tsx` 里用 useSend 接上 `onRetryPush`。
2. **预览的「部署中」态从界面进不去，中台也没有这个状态**：`PreviewTab` 有
   `state: 'deploying'`，但 `app/request/[id].tsx` 只传 `previewUrl` / `installUrl`；
   更重要的是 `StudioPlanView`（src/studio/protocol.ts）里没有 previews / 部署状态字段
   （只有 finished 后的 `release`，注释写着 P2 才加 `previews`），hub 与 App 里也找不到任何
   部署状态。SS-243 查过后记为**不适用：中台没有部署状态**，等协议加了 `previews` 再映射到
   RequestView 并传给 PreviewTab。
3. **主按钮的 done 态没有调用方**：所有 `PrimaryButton`/`SignedButton` 只传 `idle | working`，
   `state="done"` 只在单测里出现。

### 复跑

```sh
# 两档尺寸（各跑一次，换 E2E_IOS_UDID）
E2E_IOS_UDID=<iPhone 14 udid> npm run e2e -- e2e/maestro/shots-sizes.yaml
E2E_IOS_UDID=<iPhone SE udid>  npm run e2e -- e2e/maestro/shots-sizes.yaml
# 真中台子状态
E2E_IOS_UDID=<udid> npm run e2e -- e2e/maestro/shots-states.yaml
# demo 构建 + demo 子状态
EXPO_PUBLIC_DEMO=1 npx expo run:ios --no-bundler --configuration Release --device generic --output .beluga/scratch/demo-ios-build
maestro --device <udid> test --test-output-dir e2e/out/demo-states e2e/maestro/shots-states-demo.yaml
```

## 17. 手势规则逐条录屏（SS-233）

脚本：`e2e/maestro/gestures.yaml`（对着 `EXPO_PUBLIC_DEMO=1` 的构建跑）。iOS 用
`xcrun simctl io <udid> recordVideo --codec h264`，Android 用 `adb shell screenrecord`，
Maestro 在录屏过程中执行手势。录像在 `.beluga/scratch/ss-233/`。

| SS-47 的规则 | 录像里的做法 | 文件 |
|---|---|---|
| 点「结果与详情」向上滑出 | 点标题下的入口，抽屉从底部滑出 | `ios-gestures.mp4` 00:00–00:06；`android-gestures.mp4` |
| 下拉跟手 | 从抽屉顶部的拖拽条向下拖 13%（不到三成）再松手，抽屉跟手回弹到打开位置 | `ios-gestures.mp4` 00:06–00:14 |
| 拖过三成关闭 | 从拖拽条慢慢拖到屏幕底部松手，抽屉关闭回到需求详情 | `ios-gestures.mp4` 00:14–00:24 |
| 甩得够快也关闭 | 从拖拽条快速下滑（位移约 6%、80 ms）松手，抽屉关闭 | `ios-gestures.mp4` 00:24–00:34 |
| 点遮罩关闭 | 点抽屉上方的半透明遮罩，抽屉关闭 | `ios-gestures.mp4` 00:34–00:44 |
| 内容超高时在抽屉内滚动 | 打开「计划」页签，在抽屉里向上滚动两次，背后的卡片流不动 | `ios-gestures.mp4` 00:44–00:52 |
| 返回手势 | iOS：从屏幕左缘向右滑，回到需求列表（`ios-gestures.mp4` 00:52–00:57）。Android 这个 AOSP 模拟器是 3 键导航，没有边缘返回手势，用系统返回键 |
| 减弱动态效果时直接到位 | 打开系统「减弱动态效果」后重放同一套手势：抽屉没有动画，直接出现 / 消失 | `ios-gestures-reduced-motion.mp4` |

说明：
- 拖拽手势只挂在抽屉顶部（拖拽条与标题那一行），抽屉内容用 ScrollView，所以从内容区向下滑是滚动内容，不是关抽屉——这与设计一致。
- iOS 系统「减弱动态效果」用 `xcrun simctl spawn <udid> defaults write com.apple.Accessibility ReduceMotionEnabled -bool true` 打开，录完再关。
- 复跑：`maestro --device <udid> test e2e/maestro/gestures.yaml`；Android 录屏用
  `adb -s <serial> shell screenrecord /sdcard/g.mp4` 与 `adb pull`。

## 18. 签名被拒（SS-234）

假 daemon 多了一个只在 e2e 用的控制口：`POST /revoke-device`（`{}` 吊销全部、`{pubkey}` 吊销一台），
把登记过的设备移出信任名单。`run.mjs` 转发为 `/daemon/revoke-device`，Maestro 的
`control.js` 里是 `ACTION: daemonRevoke`。脚本：`e2e/maestro/shots-refused.yaml`。

流程：登录 → 邀请链接登记设备 → 进需求 → 交付验收卡 → 假节点吊销 → 点「通过」。

结果（`.beluga/scratch/ss-234/refused-unregistered.png`）：卡片仍是「等你验收」，按钮回到空闲，
按钮下方一行红字「这台手机还没登记，无法确认。请先在「我 › 设备」完成登记。」；
假 daemon 的日志同时打出 `verify-refused … code: unregistered-device`。

**顺带修掉的问题**：之前四个签名动作（`gate.answer` 开工 / 改动、`delivery.accept`、
`release.approve`）都是 `void send(...)`，卡片把「发出去」当成功。拒绝时卡片反而显示
「已通过」，客户会以为验收成功了。现在 `app/request/[id].tsx` 的 `signAndSettle` 等回执：
只有 `done` 才 resolve，`refused` / `failed` 用 `lib/strings/sign.ts` 的文案 reject，卡片
把原因显示在按钮下方并回到空闲。

复跑：`E2E_IOS_UDID=<udid> npm run e2e -- e2e/maestro/shots-refused.yaml`；
假 daemon 自检：`node packages/studio-hub/scripts/fake-daemon.mjs --self-test`。

## 19. TalkBack 在 Google APIs 模拟器上的尝试（SS-235）

结论：**这台机器装不了官方 TalkBack，转到 Android 真机（rel-device-android / SS-239）做。**

试过的路径：
1. `~/Library/Android/sdk/system-images/android-35/google_apis/arm64-v8a` 只有一个空的
   `.installer` 目录（2026-11-21 03:47 那次下载停在中途），`avdmanager` 报
   `Package path is not valid`，没有可用的 Google APIs 镜像；`sdkmanager --list` 也拿不到
   `google_apis_playstore;arm64-v8a`。
2. 即使拿到 Google APIs 镜像，它也不带 Play 商店；TalkBack（Android Accessibility Suite）
   只通过 Play 商店分发，装它需要登录 Google 账号，这台机器不能代做。
3. 手上唯一的 Android 真机（NX733J，Android 15）也没预装 TalkBack
   （`pm list packages | grep talkback` 为空）。

因此没有从 Google 官方渠道装 TalkBack 的办法，按任务约定停在交接：在真机上从 Play 商店装
「Android Accessibility Suite / TalkBack」后，执行

```sh
adb -s <serial> shell settings put secure enabled_accessibility_services com.google.android.marvin.talkback/.TalkBackService
maestro --device <serial> test e2e/maestro/talkback.yaml
```

并把录屏与 `adb logcat -s TalkBackService` 的朗读日志存到 `.beluga/scratch/ss-235/`。
`e2e/maestro/talkback.yaml` 已就绪（单击聚焦、双击激活、逐屏截图）。

## 20. Android 真机（NX733J）实测：准备与阻塞（SS-239）

已做：
- 真机联调包：`EXPO_PUBLIC_HUB_URL=http://127.0.0.1:8787` 构建（USB 上用 `adb reverse tcp:8787 tcp:8787`
  连本机中台），用工作室自己的签名密钥签（与发布包同一把），产物
  `.beluga/scratch/ss-239/Synon-Studio-0.1.0-dev.apk`（versionCode 1，签名 SHA-256 2095be…）。
- 新增 `plugins/loopback-cleartext.js`：只给 127.0.0.1 / localhost 放行明文（Android 默认只许 https），
  所以真机能连本机中台；已挂进 app.json 的 plugins。
- 本机中台 + 假 daemon：`npm run dev:device`（8787，HUB_ORIGIN 用 LAN 地址，另可用
  `npm run dev:device -- --login` 再取一条登录深链）。
- 已在 NX733J 上卸载旧包（02:52 装过一份 0.1.0），装了这个联调包并设置了 adb reverse。

阻塞：**手机一直停在锁屏**（`dumpsys trust` 报 `deviceLocked=1`、`isKeyguardShowing=true`，
锁屏要面部/密码）。三次请所有者解锁，adb 侧仍是锁屏；无法在未解锁的设备上启动、登录、截图。
解锁后继续的步骤：
```sh
adb -s 324750623054 reverse tcp:8787 tcp:8787
adb -s 324750623054 shell am start -a android.intent.action.VIEW \
  -d "synon://login?token=<dev:device 打出的 token>" com.synon.studio
# 然后按 SS-239 的清单逐屏截图/录屏：请求列表、待办、详情、提需求、验收
```
SS-239 里依赖这台机器的 SS-6、SS-11、SS-13、SS-15、SS-17、SS-37、SS-39、SS-152 都还没实测；
推送（SS-152）另外缺 Firebase 配置（`google-services.json` 未配置，FCM 令牌登记不了），
需要先建好 Firebase 项目。

## 21. iPhone 真机（Yuqing’s iPhone）实测：准备与阻塞（SS-240）

TestFlight 还传不了（SS-237：ASC 里没有 com.synon.studio 的 App 记录），所以按 SS-240 的
第二种做法：用签名好的包直装真机。

已做：
- App ID `com.synon.studio`（2449F94GST）加了 **Associated Domains** 能力；为这台 iPhone 建了
  ad-hoc 描述文件「Synon Studio Ad Hoc 2」（含设备 UDID `00008130-0011196A1A46001C`、分发证书
  5H879U2Z42），并装到本机。
- 构建（指向本机中台的 LAN 地址）：`EXPO_PUBLIC_HUB_URL=http://192.168.3.237:8787 IOS_SIGNING=manual IOS_PROFILE="Synon Studio Ad Hoc 2" IOS_EXPORT_METHOD=ad-hoc npm run build:ios -- archive`；
  产物 `.beluga/scratch/ss-240/Synon-Studio-0.1.0-adhoc.ipa`（13 MB，versionCode/构建号 1）。
  `scripts/build-ios.mjs` 新增 `IOS_EXPORT_METHOD`（默认 `app-store-connect`，ad-hoc 用 `ad-hoc`）。
- 已用 `xcrun devicectl device install app --device 00008130-0011196A1A46001C …adhoc.ipa` 装上。
- 本机中台与假 daemon 跑在 `http://192.168.3.237:8787`；登录深链可由
  `npm run dev:device -- --login` 再取一条。

阻塞：**手机停在锁屏**，所有者在结束时选择「现在不方便」；启动 App、点深链、截图都需要先解锁。
解锁后继续：
```sh
# 拉起 App 并用登录深链（token 用 dev:device 打出的）
xcrun devicectl device process launch --device 00008130-0011196A1A46001C \
  --payload-url "synon://login?token=<token>" com.synon.studio
# 截图 / 录屏
xcrun devicectl device capture screenshot --device 00008130-0011196A1A46001C --destination shot.png
xcrun devicectl device capture screen-record --device 00008130-0011196A1A46001C --destination clip.mov
```
说明：
- Universal Link 需要真实 https 域名与 AASA 文件；本机中台是 LAN IP，所以真机联调用自定义 scheme
  `synon://`，Universal Link 的验收留到生产域名（与 SS-37 的真机项一致）。
- APNs 推送（SS-152）需要先在 Apple 账号里建 APNs 密钥并在项目里配置，当前没有，推送三项到真机才能做。
- 直装用的是分发证书 + ad-hoc 描述文件，不需要在手机上信任开发者。
- `dist/ios/` 已恢复为 App Store 签名的那份 IPA，供 SS-237 上传；ad-hoc 的包在
  `.beluga/scratch/ss-240/`，不要上传它。

## 22. 扫码加设备：为什么现在做不了（SS-241 / SS-74）

ss-241 的做法是「一台已登记的手机打开『我 › 设备 › 加一台设备』显示二维码，另一台用相机扫码」。
对照代码，这一步现在不成立：

1. **App 没有「显示二维码」的入口。** `app/me/devices/add.tsx` 是**扫码**屏（`expo-camera` 的
   `CameraView` + `parseInvitePayload`），没有生成二维码的界面；整个 studio-app 里也没有二维码库。
   SS-74 的设计原本是「桌面端出二维码，手机扫」，但 Mac 端的 `QrCode` 组件只用在 Beluga 的连接 /
   邀请上，Studio 的设备邀请没有对应的桌面屏；邀请链接目前只从 hub 管理端（`/v1/admin/invites`）
   发出来，是一条链接。
   可行的代替：用 hub 的邀请链接在 Mac 上渲染二维码（`src/cli/qr.ts` 的 `qrLines` 可以在终端画，
   也可以生成 PNG），新手机扫它即可走同一套 `lib/enrol.ts`。但「手机上显示二维码」这一条确实
   缺入口，记为问题。
2. **两台真机都锁着。** iPhone（Yuqing’s iPhone）停在锁屏，NX733J `deviceLocked=1`；所有者选择
   先写交接。扫码要相机和对面的界面，adb/`devicectl` 都没法在锁屏上点。

补齐后要做的验证：
- 用 hub 管理端发一个一次性邀请（`POST /v1/admin/invites`，带上 studioId/daemonId），把
  `synon://join/<id>#k=…&n=…` 渲染成二维码；
- 新手机「我 › 设备 › 加一台设备」扫码 → 核对指纹 → 登记；
- 两台手机的「我 › 设备」列表都截图（新设备在里）；
- 用新设备点一次签名动作（交付卡「通过」），确认回执是 done 而不是 unregistered-device。

## 23. A10 截图项结算与补拍（SS-245）

A10 的截图只留在当时的任务附件里，本轮重新拍了一份可查的（`.beluga/scratch/ss-245/`）。
脚本：`e2e/maestro/shots-settle.yaml`（demo 构建，直接对装好的包跑）、
`e2e/maestro/shots-settle-real.yaml`（真中台 + 假 daemon，拍抽屉空态）。

| 任务 | 截图 | 内容 |
|---|---|---|
| SS-44 P4 步骤条 | `settle-steps.png` | 四步一格一态：完成、进行中、等待（斜纹）、未开始 |
| SS-45 P4 等待卡 | `state-wait-queued.png`、`state-wait-quota.png`、`state-wait-human.png`、`state-wait-offline.png`（SS-232） | 四种原因 + 「什么时候会好」 + 「你不用做什么」，全灰不用红 |
| SS-49 抽屉成果 | `settle-drawer-outputs.png`（有内容：第 2 轮在线预览、iOS 安装包、客户附件）、`settle-drawer-outputs-empty.png`（空态 InlineHint） | 有 / 空两态 |
| SS-50 抽屉改动 | `settle-drawer-changes.png`（新增/修改列表）、`settle-drawer-changes-empty.png`（「还没有改动记录」） | 有 / 空两态 |
| SS-54 P9 我 | `settle-me.png` | 账号头 + 项目与运行 / 设备与账号两组入口 |
| SS-56 我 › 执行机器 | `settle-machines.png` | 同一屏三种机器：在线可接单（42/100）、离线「等待」、用量将满（87/100，琥珀 warn） |
| SS-57 我 › 项目与代码交付 | `settle-project.png` | 每个项目的平台、运行方式、交付方式、仓库与令牌状态（不显示令牌） |

说明：SS-56 的「用量将满」在 demo 数据里原本没有 ≥80% 的机器，补了一个第三台
`runner-3`（87/100，只加数据，不改界面）。抽屉空态用真中台的 `running` 视图拍（没有交付物、
没有草稿改动），因为 demo 的 `?state=empty` 只在 P4 支持 `runnerOffline`，没有 empty 分支。

## 24. 真机推送三项：留到发布之后（SS-249 / SS-152）

SS-249 要在两台真机上验三件事：同一张「等你」卡只收一条、点开到那张卡、处理后角标减一、
退出登录后不再收到。现在是**发布后验证**，原因有三：

1. **没有推送凭证**：本机找不到 Firebase 的 Android 配置、APNs 密钥与 Key ID、以及中台用的
   Firebase 服务账号 JSON；studio-hub 的本地环境文件也没有。App 的推送登记
   （`lib/push.ts` → APNs/FCM 设备令牌）没有凭证会失败，中台也发不出推送。
   SS-248 问过两次用户路径都没拿到。
2. **两台真机都锁着**：iPhone 与 NX733J 多个小时一直停在锁屏，连主流程走查都没做成
   （SS-239 / SS-240 的交接）。
3. 唯一找到的 `.p8` 是 App Store Connect 那把，它不一定是 APNs 密钥，不能拿来顶替。

凭证放好、手机解锁后按 SS-152 的交接跑：`npm run dev:device` → 真机登录 →
`npm run dev:device -- --push-demo`（连推同一张卡两次验去重）→ 截图一条通知与点开跳卡 →
处理掉后看角标 → 退出登录再推一次并看中台日志。

## 25. 「加一台设备」的邀请二维码：缺的是发邀请的接口（SS-244 / SS-74）

SS-244 要在手机上做「加一台设备」二维码屏：已登记的手机向节点要一条新的设备邀请，把
`synon://join/<id>#k=…&n=…` 画成二维码，另一台扫它。查过之后，**缺的不是二维码库，而是
「由已登记设备发邀请」的接口**：

- App 现在能做的只有**扫**（`app/me/devices/add.tsx`）和**兑**（`lib/enrol.ts` →
  `POST /v1/app/devices/enroll`）。
- 邀请是**节点签发**的：`beluga studio invite <客户邮箱>`（docs/studio-standalone.md §2）生成
  inviteId 与一次性 `k`，`k` 不离开节点；中台只存路由，只有**运营者令牌**的
  `POST /v1/admin/invites` 能把这条路由写进去。客户会话没有任何发邀请的接口，
  `StudioAction` 里也没有对应的签名动作，所以手机端做不出「向节点要一条邀请」这一步。
- 唯一有 `POST /v1/admin/invites` 权限的是运营者/假节点，app 不该也不可能有这个令牌。

按 SS-244 的约定**停下来，不改界面**，用替代路径：在 Mac/节点上发邀请并画二维码。
`src/cli/qr.ts` 的 `qrLines` 能在终端画，也可以把同一个链接渲染成 PNG 贴到 Mac 屏幕上；
另一台手机仍然用 `app/me/devices/add.tsx` 扫它，登记走原来的 `lib/enrol.ts`，这条链路是通的。
建议的补齐方式（后续任务）：中台加一条客户会话可调的 `POST /v1/app/devices/invite`，由中台
转给节点签发（`k` 仍只在节点），返回 `synon://join/<id>#k=…&n=…` 给 App；再做
`app/me/devices/invite.tsx` 显示二维码（用与 `src/cli/qr.ts` 同一个 `qrcode-generator`，
`react-native-svg` 画矩阵，不引入原生依赖），最后用 `add.tsx` 的解析函数单测串起来。


