# Synon Studio 真机验收清单

给所有者亲手执行。手机两次窗口都停在锁屏，自动化做不了；这里把每一条真机项写成可照着做的步骤。
模拟器上已经成立的部分（发布包拉起、登录、提需求、验收卡、30 张状态截图、手势录屏）见
`docs/studio-mobile-walkthrough.md`，本清单只写真机才能证明的事。

设备：**Yuqing's iPhone**（iPhone 15 Pro Max，UDID `00008130-0011196A1A46001C`）与
**NX733J**（Android 15，序列号 `324750623054`）。每做完一条，把截图/录屏放进
`.beluga/scratch/device-acceptance/` 并在对应任务上勾掉。

---

## §1 准备

1. 两台手机关掉自动锁屏、接电、停在桌面；Android 去掉锁屏密码（`adb shell locksettings clear --old <PIN>` 或用系统设置）。
2. 本机中台与假 daemon：

   ```sh
   cd packages/studio-app && npm run dev:device
   # 再取一条登录深链（一次性）：
   npm run dev:device -- --login
   ```

3. Android 连本机中台（USB 回环）：

   ```sh
   adb -s 324750623054 reverse tcp:8787 tcp:8787
   ```

   iPhone 走 Wi-Fi 到 Mac 的 LAN 地址（`http://<Mac 的 LAN IP>:8787`），构建时用
   `EXPO_PUBLIC_HUB_URL=http://<Mac 的 LAN IP>:8787`（见 §3 的包）。
4. 通过标准：`adb -s 324750623054 shell dumpsys trust | grep deviceLocked` 显示 `deviceLocked=0`；
   iPhone 截图是桌面而不是锁屏。

## §2 TestFlight 上传与安装（SS-99 / SS-237）

前提：一个能看见 `com.synon.studio` 的 App Store Connect API 密钥（本机现有的 beluga 密钥看不到）。

1. 用有权限的账号登录 asc（密钥内容不要贴聊天）：

   ```sh
   asc auth login --name synon --key-id <KEY_ID> --issuer-id <ISSUER_ID> --private-key <路径>
   asc auth status --validate
   ```

2. 查 App ID 与测试组：

   ```sh
   asc apps list --bundle-id "com.synon.studio" --output table
   asc testflight groups list --app <APP_ID> --output table
   ```

3. 上传（先归档再传；归档命令见 SS-237 交接）：

   ```sh
   CONFIRM_UPLOAD=yes ASC_APP_ID=<APP_ID> GROUP="<组名>" npm run build:ios -- upload
   ```

4. 在 iPhone 的 TestFlight 里装这个构建，打开 App 确认能到登录页。
5. 通过标准：TestFlight 里这个构建处理完、可安装；手机上能看到登录页。
   证据：上传输出（构建号）、TestFlight 截图、手机主屏图标截图。

## §3 两台真机主流程与逐项（SS-6 / SS-7 / SS-11 / SS-13 / SS-15 / SS-17 / SS-37 / SS-39）

装包：Android 用发布密钥签的 release APK（指向 `127.0.0.1:8787`，配合 §1 的 adb reverse）：

```sh
adb -s 324750623054 install -r packages/studio-app/dist/Synon-Studio-<version>.apk
```

iPhone 用 TestFlight（§2）或直装 ad-hoc 包（无 TestFlight 时）：

```sh
xcrun devicectl device install app --device 00008130-0011196A1A46001C \
  .beluga/scratch/ss-240/Synon-Studio-0.1.0-adhoc.ipa
```

**§3.1 第一次装上 → 登录 → 走完一个需求（SS-6 / SS-7）**

1. 确认包没装过（Android：`adb shell pm list packages | grep synon` 为空；iPhone 主屏无图标），
   装上，打开，看登录页。
2. 深链登录（SS-37 的「链接回到 App」）：

   ```sh
   # Android
   adb -s 324750623054 shell am start -a android.intent.action.VIEW \
     -d "synon://login?token=<token>" com.synon.studio
   # iPhone
   xcrun devicectl device process launch --device 00008130-0011196A1A46001C \
     --payload-url "synon://login?token=<token>" com.synon.studio
   ```

   生产环境用邮件里的 https 链接（Universal Link / App Link）；本机中台没有域名与 AASA，
   所以这里用自定义 scheme，邮件点击那条在 §2 的 TestFlight 构建上再点一次。
3. 需求列表 → 待办 → 打开一条需求 → 提一个需求 → 到验收卡（模拟器上已走通，见
   `docs/studio-mobile-walkthrough.md` §26；真机再走一遍）。
4. 录屏：Android `adb shell screenrecord /sdcard/walk.mp4` + `adb pull`；
   iPhone `xcrun devicectl device capture screen-record --device <udid> --destination walk.mov`。
5. 通过标准：每屏都能到、没有崩溃；录屏里能看到登录、列表、提需求、验收卡。
   证据：录屏 + 每屏截图。

**§3.2 重启保持（SS-11）**

1. 在提需求页输入一段草稿，不要发送；切到后台。
2. 杀掉 App 再打开（Android `adb shell am force-stop com.synon.studio`；iPhone 上滑关闭）。
3. 通过标准：仍然登录；回到提需求页草稿还在；需求列表与详情有缓存、不用等网络。
   证据：重启前后的截图（登录态 + 草稿）。

**§3.3 登出清空（SS-13）**

1. 我 › 账号 › 退出登录。
2. 重新打开 App。
3. 通过标准：回到登录页，不会自动进工作台。
   证据：登出后与重开后的截图。

**§3.4 飞行模式横幅（SS-15）**

1. 在需求列表页打开飞行模式（Android `adb shell cmd connectivity airplane-mode enable`；
   iPhone 控制中心）。
2. 切到「我」再切回「需求」，触发一次刷新。
3. 通过标准：顶部出现离线横幅（SyncBanner），按钮不假装成功。
   证据：两张截图（飞行模式 + 恢复网络后的横幅消失）。

**§3.5 切后台撤销（SS-17）**

1. 在交付卡点「通过」（需要设备已有密钥，先按 §5 登记；或在开工/改动卡上做）。
2. 在 10 秒撤销窗口内立刻把 App 切到后台。
3. 等 10 秒以上再回前台。
4. 通过标准：动作在撤销到点时已经发出（卡上变成已通过/已完成）；回前台看到最新状态，不是旧的。
   证据：切后台前、回前台后的截图 + 中台日志里这条动作的回执。

**§3.6 拼音组字回车（SS-39）**

1. 用中文输入法（微信输入法/Gboard 中文）在提需求或对话输入框里打一段拼音，**组字未上屏时按回车**。
2. 通过标准：只上屏，不发送；再按一次回车/发送键才发出。
   证据：组字中与上屏后的截图（或一段录屏）。

**§3.7 通知权限与角标基础（并入 §6）**

## §4 TalkBack（SS-94）

前提：Android 手机上从 **Google Play** 装「Android Accessibility Suite」（TalkBack）。本机没有
官方镜像可装（SS-235 记过），只能真机做。

```sh
adb -s 324750623054 shell settings put secure enabled_accessibility_services com.google.android.marvin.talkback/.TalkBackService
maestro --device 324750623054 test e2e/maestro/talkback.yaml
# 录屏
adb -s 324750623054 shell screenrecord /sdcard/tb.mp4
# 朗读日志
adb -s 324750623054 logcat -s TalkBackService > talkback.log
```

通过标准：TalkBack 开着能「单击聚焦、双击激活」走完登录 → 列表 → 详情 → 待办；朗读出每屏的标题与按钮名。
证据：录屏 + logcat 片段。做完关掉：

```sh
adb -s 324750623054 shell settings delete secure enabled_accessibility_services
```

## §5 扫码配对（SS-74 / SS-241）

前提：**App 内没有发邀请的接口**（SS-244：邀请由节点签发、中台只有运营者令牌的 admin 接口），
所以二维码在 Mac 上生成，手机只负责扫。

1. 用运营者令牌发一条邀请，并拿到带 `#k=&n=` 的链接：

   ```sh
   # hub 管理端（本地 dev 的令牌见 packages/studio-hub 的 dev 环境）
   curl -sS -X POST http://127.0.0.1:8787/v1/admin/invites \
     -H "authorization: Bearer <operator-token>" -H "content-type: application/json" \
     -d '{"inviteId":"<id>","studioId":"<studio>","daemonId":"<daemon>","expiresAt":<ms>}'
   ```

   邀请里的 `k` 只有节点知道；本地联调可用假 daemon 的 `/invite` 动作直接拿到完整链接。
2. 在 Mac 上把链接画成二维码（`src/cli/qr.ts` 的 `qrLines` 可在终端画，也可渲染成 PNG）：

   ```sh
   node --experimental-strip-types -e \
     "import('./src/cli/qr.ts').then(m=>console.log(m.qrLines(process.argv[1]).join('\n')))" \
     "synon://join/<id>#k=<k>&n=<n>"
   ```

3. 新手机打开「我 › 设备 › 加一台设备」→ 相机扫码 → 核对指纹 → 登记。
4. 两台手机的「我 › 设备」都看一遍；再用新手机点一次交付卡「通过」。
5. 通过标准：两边设备列表都有这台新手机；新手机的签名动作回执是 done（不是 unregistered-device）。
   证据：两边设备列表截图 + 回执截图。

## §6 推送三项（SS-152 / SS-249）

前提：三样凭证到位——Firebase 的 Android 配置（放进 `packages/studio-app`，app.config.ts 会自动接上）、
APNs 密钥 `.p8` 与 10 位 Key ID、中台用的 Firebase 服务账号 JSON（放进 `packages/studio-hub` 的
环境变量/`.dev.vars`）。凭证只给路径，不进仓库。

1. 重新构建并装上带推送配置的包（Android APK / TestFlight 构建）。
2. 登录后允许通知；`npm run dev:device` 跑着，另开一个终端：

   ```sh
   npm run dev:device -- --push-demo
   ```

   会连推同一张「等你」卡两次。
3. 通过标准：
   - 只收到**一条**通知（不会重复）；
   - 点通知直接到那张卡（截图）；
   - 处理后角标减一（截图角标）；
   - 退出登录后再推一次，中台日志里不再发给这台设备（`dev:device` 输出 / hub 日志）。
4. 证据：三组截图 + 中台日志片段（`sent` / `skipped` 行）。

---

## 这些真机项现在在哪

本清单是各任务真机项的最终落点：SS-6、SS-7、SS-11、SS-13、SS-15、SS-17、SS-37、SS-39、SS-74、
SS-94、SS-99、SS-152、SS-237、SS-239、SS-240、SS-241、SS-249 的相关验收项都已改写成
「移到真机验收清单 §n」。模拟器上成立的部分（发布包构建/拉起、登录、提需求、验收卡、状态截图、
手势录屏）保留在 `docs/studio-mobile-walkthrough.md`，不在本清单重复。
