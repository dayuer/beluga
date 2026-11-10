import type { IconName } from '../components/Icon.js';
import { t, tl } from '../i18n/index.js';
import { keyPlatform } from '../lib/shortcuts-model.js';
import { buttonLabel } from '../lib/prefs-words.js';
import type { PaneInfo, SettingEntry, SettingsPane } from '../lib/settings-search.js';
// Relative, not @beluga/ui: the root's tests and typecheck read this file too.
import { HIDEABLE_BUTTONS } from '../../../../src/ui/settings-menus.js';
import { EXPERIMENTS, EXPERIMENT_INFO } from '../../../../src/shared/experiments.js';

/** Settings' panes, in sidebar order, with other words people use for them (in the language shown now). */
export const panes = (): ReadonlyArray<PaneInfo<SettingsPane> & { icon: IconName; keywords?: string }> => [
  { id: 'general', label: t('settings.pane.general'), icon: 'gear', keywords: 'profile account 通用 个人资料 账户' },
  { id: 'appearance', label: t('settings.pane.appearance'), icon: 'eye', keywords: 'look themes colors colours display language 外观 主题 颜色 显示 语言 中文' },
  { id: 'claude', label: t('settings.pane.claude'), icon: 'spark', keywords: 'claude codex model ai 模型 智能体' },
  { id: 'notifications', label: t('settings.pane.notifications'), icon: 'bell', keywords: 'alerts sounds 通知 提醒 声音' },
  { id: 'workspaces', label: t('settings.pane.workspaces'), icon: 'branch', keywords: 'worktrees projects git 工作区 工作树 项目' },
  { id: 'terminal', label: t('settings.pane.terminal'), icon: 'terminal', keywords: 'shell console xterm 终端 命令行' },
  { id: 'fire', label: t('settings.pane.fire'), icon: 'flame', keywords: 'flames effects celebration 火焰 彩纸 特效' },
  { id: 'menubar', label: keyPlatform() === 'mac' ? t('settings.pane.menuBar') : t('settings.pane.tray'), icon: 'laptop', keywords: 'menu bar tray status icon whale 菜单栏 托盘 图标 鲸鱼' },
  { id: 'environment', label: t('settings.pane.environment'), icon: 'lock', keywords: 'env .env variables secrets api keys 环境变量 密钥' },
  { id: 'people', label: t('settings.pane.people'), icon: 'people', keywords: 'friends trust network permissions 好友 信任 网络 权限' },
  { id: 'phone', label: t('settings.pane.phone'), icon: 'phone', keywords: 'android iphone mobile companion 手机 安卓' },
  { id: 'external', label: t('more.sync.pane.external'), icon: 'bot', keywords: 'mcp grokbot claude code codex pairing code token oauth remote 外部 智能体 配对 令牌' },
  { id: 'computers', label: t('settings.pane.computers'), icon: 'server', keywords: 'machines servers mac mini aws cloud ssh remote linux pair 电脑 服务器 云 远程 配对' },
  { id: 'voice', label: t('settings.pane.voice'), icon: 'mic', keywords: 'dictation speech microphone talk transcribe 语音 听写 麦克风' },
  { id: 'keyboard', label: t('settings.pane.keyboard'), icon: 'command', keywords: 'shortcuts keys hotkeys bindings 键盘 快捷键' },
  { id: 'advanced', label: t('settings.pane.advanced'), icon: 'wrench', keywords: 'web access browser agent threads 高级 浏览器 线程' },
  { id: 'experimental', label: t('settings.pane.experimental'), icon: 'flask', keywords: 'labs beta early preview features try 实验 测试 预览' },
  { id: 'about', label: t('settings.pane.about'), icon: 'globe', keywords: 'version logs support 关于 版本 日志 支持' },
];

type Entry = SettingEntry<SettingsPane>;

/** Shown with agent threads on (see SettingsSearch). */
export const threadLimitsGroup = (): string => t('settings.threads.limits');

/** The rows of one group of a pane: `[label, detail?, keywords?]`. */
const rows = (pane: SettingsPane, group: string | undefined, list: ReadonlyArray<readonly [string, string?, string?]>): Entry[] =>
  list.map(([label, detail, keywords]) => ({ pane, label, ...(group ? { group } : {}), ...(detail ? { detail } : {}), ...(keywords ? { keywords } : {}) }));

/** A group as a whole (its rows aren't `Row`s, or are made from data). */
const group = (pane: SettingsPane, label: string, detail?: string, keywords?: string): Entry => ({ pane, label, isGroup: true, ...(detail ? { detail } : {}), ...(keywords ? { keywords } : {}) });

/**
 * Every setting the search finds (BLG-740), by pane and in the pane's order. Kept by hand next to
 * the panes; tests/mac-settings-search.test.ts fails when a pane gains a row or group missing
 * here, or loses one listed here. Labels are the panes' own words, so the jump finds the row
 * (Row and Group carry data-setting anchors made from them).
 */
export const settingsIndex = (): readonly Entry[] => [
  // General
  ...rows('general', undefined, [
    [t('settings.general.name'), t('settings.find.name'), 'profile display name 名字 昵称'],
    [t('settings.general.picture'), t('settings.find.picture'), 'avatar photo profile image 头像 照片'],
    [t('settings.general.requests'), t('settings.general.requestsDetail'), 'default policy trust sharing allow private 默认 策略 信任 共享'],
  ]),
  group('general', t('settings.updates.title'), t('settings.find.updates'), 'update upgrade version new release 更新 升级 版本'),
  ...rows('general', t('settings.updates.title'), [
    [t('settings.updates.auto'), t('settings.find.updatesAuto'), 'auto update upgrade 自动更新'],
    [t('settings.updates.check'), t('settings.find.updatesCheck'), 'update version check now 检查更新'],
  ]),
  ...rows('general', t('settings.writing.title'), [
    [t('settings.writing.sendWith'), t('settings.find.sendWith'), 'enter return send message newline new line keyboard 发送 回车 换行'],
    [t('settings.writing.duringTurn'), t('settings.find.duringTurn'), 'queue steer enter return send message running busy interrupt default 排队 插话 打断'],
    [t('settings.writing.times'), undefined, 'timestamps time clock 时间 时间戳'],
    [t('settings.writing.steps'), t('settings.find.steps'), 'fold steps tools collapse expand show steps 折叠 展开 步骤'],
  ]),
  ...rows('general', t('settings.earnings.title'), [[t('settings.earnings.showIn'), t('settings.find.earnings'), 'currency money stripe revenuecat usd eur dollars 货币 收入 美元']]),

  // Appearance
  ...rows('appearance', undefined, [
    [t('settings.appearance.language'), t('settings.find.language'), 'language locale english chinese 语言 中文 英文 简体'],
    [t('settings.appearance.appearance'), t('settings.find.appearance'), 'dark mode light mode night theme system 深色 浅色 夜间 主题'],
    [t('settings.appearance.accent'), t('settings.find.accent'), 'color colour highlight tint 强调色 颜色 高亮'],
  ]),
  group('appearance', t('settings.appearance.lightTheme'), t('settings.find.lightTheme'), 'theme day colors colours palette latte 浅色 主题 配色'),
  group('appearance', t('settings.appearance.darkTheme'), t('settings.find.darkTheme'), 'theme night colors colours palette oled black 深色 主题 配色 黑色'),
  ...rows('appearance', t('settings.lowPower.title'), [[t('settings.lowPower.mode'), t('settings.find.lowPower'), 'battery energy save power performance slow 电池 省电 性能']]),
  ...rows('appearance', t('settings.layout.title'), [
    [t('settings.layout.textSize'), t('settings.find.textSize'), 'font size zoom bigger smaller scale 字号 字体 缩放 放大 缩小'],
    [t('settings.layout.density'), t('settings.find.density'), 'compact comfortable spacing 紧凑 宽松 间距'],
    [t('settings.layout.width'), t('settings.find.width'), 'chat width narrow wide full 宽度 窄 宽'],
    [t('settings.layout.unread'), t('settings.find.unread'), 'unread finished section 未读 已完成'],
    [t('settings.layout.categories'), t('settings.layout.categoriesDetail'), 'inbox working later remind snoozed snooze settled settle triage chats 收件箱 稍后 了结 分类'],
    [t('settings.layout.settleMerge'), t('settings.find.settleMerge'), 'auto settle merge merged pr automatic 了结 合并 自动'],
    [t('settings.layout.settleIdle'), t('settings.find.settleIdle'), 'auto settle idle inactive days automatic 了结 闲置 自动'],
    [t('settings.layout.sidebarWidth'), undefined, 'sidebar size 侧边栏 宽度'],
    [t('settings.layout.reduceMotion'), undefined, 'animation motion accessibility 动画 动效 辅助功能'],
    [t('settings.layout.reduceTransparency'), t('settings.find.reduceTransparency'), 'blur vibrancy translucent solid accessibility 模糊 透明 辅助功能'],
  ]),

  // Agent
  ...rows('claude', undefined, [
    [t('settings.agent.yourAgent'), t('settings.find.yourAgent'), 'model runtime claude codex default opus sonnet 模型 默认'],
    [t('settings.agent.effort'), t('settings.find.effort'), 'reasoning think effort max high low 推理 思考 强度'],
    [t('settings.agent.askFirst'), t('settings.agent.askFirstDetail'), 'approval permission self approval bash 审批 权限 命令'],
  ]),
  group('claude', t('settings.agent.agents'), t('settings.find.agents'), 'sign in install login claude code codex 登录 安装'),
  ...rows('claude', t('settings.agent.agents'), [[t('settings.agent.justNow'), t('settings.find.justNow'), 'check again refresh 重新检查 刷新']]),
  group('claude', t('autoRoute.title'), t('autoRoute.findDetail'), 'auto route model glm deepseek haiku opus hard 自动 路由 模型 疑难'),
  ...rows('claude', t('autoRoute.title'), [
    [t('autoRoute.on'), t('autoRoute.findDetail'), 'auto route autopilot model pick 自动 路由 自动驾驶 选模型'],
    [t('autoRoute.urgent'), undefined, 'urgent high priority hard opus 紧急 高优先级 疑难'],
  ]),
  group('claude', t('settings.flags.title'), t('settings.find.flags'), 'args arguments cli flags dangerously skip permissions 启动参数 参数'),
  ...rows('claude', t('settings.flags.title'), [
    ['Claude Code', t('settings.find.flagsClaude'), 'flags arguments cli 参数'],
    ['Codex', t('settings.find.flagsCodex'), 'flags arguments cli 参数'],
  ]),
  group('claude', t('settings.mcp.title'), t('settings.find.mcp'), 'mcp tools servers connectors 工具 服务器 连接器'),
  ...rows('claude', t('settings.localModels.title'), [[t('settings.localModels.run'), t('settings.find.localModels'), 'ollama lm studio local llm offline 本地模型 离线']]),
  ...rows('claude', t('settings.agent.inChat'), [[t('settings.agent.subagents'), t('settings.find.subagents'), 'subagents task tool agents 子 agent 子代理']]),
  ...rows('claude', t('settings.context.title'), [
    [t('settings.context.meter'), t('settings.context.meterDetail'), 'context window tokens usage 上下文 用量'],
    [t('settings.context.autoCompact'), t('settings.find.autoCompact'), 'compact compaction summarize context 压缩 总结 上下文'],
    [t('settings.context.compactAt'), t('settings.find.compactAt'), 'compact threshold percent context 压缩 阈值 百分比'],
  ]),
  ...rows('claude', t('settings.usage.title'), [
    [t('settings.usage.continue'), t('settings.find.usageContinue'), 'usage limit rate limit reset resume continue automatically auto quota session 用量 限额 重置 继续'],
    [t('settings.usage.skipped'), t('settings.find.usageSkipped'), 'usage limit skip session resume continue 用量 跳过 继续'],
    [t('settings.usage.chatsOff'), t('settings.find.usageChatsOff'), 'usage limit chats off resume continue 用量 聊天 继续'],
  ]),
  ...rows('claude', t('settings.parallel.title'), [[t('settings.parallel.label'), t('settings.find.parallel'), 'parallel concurrency limit queue simultaneous runs 并行 并发 同时 排队']]),
  ...rows('claude', t('settings.chatLimit.title'), [[t('settings.chatLimit.label'), t('settings.find.chatLimit'), 'chat limit tabs sentinel 聊天 上限 标签页 哨兵']]),
  // Their rows' words come from shared/threads.ts, as the pane shows them.
  ...rows('claude', threadLimitsGroup(), [
    [t('prefs.threadLimit.depth.label'), t('prefs.threadLimit.depth.find'), 'thread depth child sub-agent limit 线程 层级'],
    [t('prefs.threadLimit.treeRunning.label'), t('prefs.threadLimit.treeRunning.find'), 'thread running tree limit 线程 同时'],
    [t('prefs.threadLimit.treeLive.label'), t('prefs.threadLimit.treeLive.find'), 'thread archived tree limit 线程 归档'],
    [t('prefs.threadLimit.macRunning.label'), t('prefs.threadLimit.macRunning.find'), 'thread running mac computer limit 线程 电脑'],
  ]),
  ...rows('claude', t('settings.agent.scratch'), [
    [t('settings.agent.scratchGive'), t('settings.find.scratch'), 'scratch screenshots logs notes 草稿 截图 日志 笔记'],
    [t('settings.agent.scratchTab'), t('settings.find.scratchTab'), 'scratch tab panel 草稿 标签页 面板'],
  ]),
  ...rows('claude', t('settings.agent.prTemplates'), [
    [t('settings.agent.prInstructions'), t('settings.find.prInstructions'), 'pr prompt github 提示词 说明'],
    [t('settings.agent.templates'), t('settings.find.templates'), 'task templates start 任务 模板'],
  ]),

  // Notifications
  ...rows('notifications', undefined, [
    [t('settings.notifications.desktop'), t('settings.notifications.desktopDetail'), 'alerts banners notify 通知 横幅 提醒'],
    [t('settings.notifications.popups'), t('settings.find.popups'), 'popup pop-up overlay corner card 弹窗 卡片'],
    [t('settings.notifications.seePopup'), t('settings.find.seePopup'), 'preview popup test 预览 弹窗 测试'],
    [t('settings.notifications.onlyAway'), t('settings.find.onlyAway'), 'focus background away 后台 离开 专注'],
  ]),
  ...rows('notifications', t('settings.sound.title'), [
    [t('settings.sound.sounds'), undefined, 'sound chime audio mute 声音 提示音 静音'],
    [t('settings.sound.notificationSound'), undefined, 'sound chime audio tone 声音 提示音'],
    [t('settings.sound.volume'), undefined, 'sound loud quiet audio 音量'],
    [t('settings.sound.test'), t('settings.find.testNotification'), 'try test notification 测试 通知'],
  ]),
  ...rows('notifications', undefined, [[t('settings.notifications.dnd'), t('settings.notifications.dndDetail'), 'dnd quiet mute silence snooze focus 勿扰 静音 专注']]),
  group('notifications', t('settings.notifications.tellMe'), t('settings.find.tellMe'), 'events notify alerts 事件 通知'),
  ...rows('notifications', t('settings.notifications.tellMe'), [
    [t('settings.notifications.needsYou'), t('settings.find.needsYou'), 'question approval needs you 提问 审批 等你处理'],
    [t('settings.notifications.done'), t('settings.find.done'), 'done finished complete 完成'],
    [t('settings.notifications.doneHere'), t('settings.find.doneHere'), 'done finished long run 完成'],
    [t('settings.notifications.mentions'), t('settings.find.mentions'), 'mention dm message 提及 私信 消息'],
    [t('settings.notifications.people'), t('settings.find.peopleCome'), 'join leave invite 加入 离开 邀请'],
    [t('settings.notifications.background'), t('settings.find.background'), 'background setup 后台 安装'],
    [t('settings.notifications.sentinels'), t('settings.find.sentinels'), 'sentinel watcher 哨兵'],
    [t('settings.notifications.problems'), t('settings.find.problems'), 'errors failures conflicts 错误 失败 冲突'],
    [t('settings.notifications.pr'), t('settings.find.pr'), 'pr github checks review 检查 审查'],
    [t('settings.notifications.planMilestones'), t('settings.find.planMilestones'), 'plan milestones 计划 里程碑'],
  ]),

  // Workspaces
  ...rows('workspaces', undefined, [
    [t('settings.workspaces.setup'), t('settings.find.setup'), 'npm install setup command auto setup 安装 命令'],
    [t('settings.workspaces.branchPrefix'), t('settings.find.branchPrefix'), 'git branch name prefix 分支 前缀'],
    [t('settings.workspaces.pushToPr'), t('settings.find.pushToPr'), 'push pr pull request git agent commits 推送 提交'],
    [t('settings.workspaces.friends'), t('settings.find.friendWorktrees'), 'friend worktrees 好友 工作树'],
  ]),
  group('workspaces', t('settings.workspaces.hidden'), t('settings.find.hidden'), 'hide show unhide project sidebar 隐藏 显示 项目'),
  group('workspaces', t('settings.workspaces.toolbar'), t('settings.find.toolbar'), 'toolbar buttons hide show 工具栏 按钮'),
  ...rows(
    'workspaces',
    t('settings.workspaces.toolbar'),
    HIDEABLE_BUTTONS.map(([id, label]) => [buttonLabel(id, label), t('settings.find.toolbarButton'), 'toolbar button hide show 工具栏 按钮'] as const),
  ),

  // Terminal
  ...rows('terminal', t('settings.terminal.shell'), [
    [t('settings.terminal.shell'), t('settings.find.shell'), 'zsh bash fish shell'],
    [t('settings.terminal.path'), t('settings.find.shellPath'), 'shell path binary 路径'],
    [t('settings.terminal.login'), undefined, 'login profile zprofile 登录'],
    [t('settings.terminal.extraArgs'), undefined, 'shell args arguments flags 参数'],
  ]),
  ...rows('terminal', undefined, [
    [t('settings.terminal.font'), t('settings.find.termFont'), 'terminal font family monospace typeface 字体 等宽'],
    [t('settings.terminal.size'), t('settings.find.termSize'), 'terminal text zoom 字号 大小'],
    [t('settings.terminal.lineHeight'), undefined, 'terminal spacing line height 行高'],
    [t('settings.terminal.cursor'), t('settings.find.cursor'), 'terminal cursor caret block bar underline 光标'],
    [t('settings.terminal.blink'), undefined, 'terminal cursor blink 光标 闪烁'],
    [t('settings.terminal.scrollback'), t('settings.find.scrollback'), 'terminal history lines buffer 回滚 历史'],
    [t('settings.terminal.optionMeta'), undefined, 'alt option meta key 按键'],
  ]),
  group('terminal', t('settings.terminal.inWindow'), t('settings.find.inWindow'), 'dock toggle terminal shortcut 终端 抽屉 快捷键'),
  group('terminal', t('settings.terminal.colours'), t('settings.find.termColours'), 'terminal theme colors colours palette 颜色 主题 配色'),
  ...rows('terminal', t('settings.terminal.import'), [
    [t('settings.terminal.importFrom'), t('settings.find.importFrom'), 'import iterm ghostty terminal app theme 导入'],
    [t('settings.terminal.colours'), t('settings.find.importColours'), 'import colors theme 导入 颜色'],
  ]),
  ...rows('terminal', t('settings.terminal.advanced'), [
    [t('settings.terminal.ownTerminal'), t('settings.find.ownTerminal'), 'terminal view tui claude code 终端 视图'],
    [t('settings.terminal.openAs'), t('settings.find.openAs'), 'chat terminal view default 聊天 终端 默认'],
  ]),
  ...rows('terminal', t('settings.terminal.keysGroup'), [[t('settings.terminal.keysFirst'), t('settings.find.keysFirst'), 'keys shortcuts terminal keyboard 按键 快捷键']]),

  // Fire & Confetti
  group('fire', t('settings.fire.whatsOn'), t('settings.find.whatsOn'), 'fire on off enable flames 火焰 开关'),
  ...rows('fire', t('settings.fire.whatsOn'), [[t('settings.fire.where'), t('settings.find.fireWhere'), 'max effort model 强度 模型']]),
  group('fire', t('settings.common.startFrom'), t('settings.find.firePresets'), 'preset fire style 预设 风格'),
  ...rows('fire', t('settings.fire.whenHow'), [
    [t('settings.fire.whenBurns'), undefined, 'fire burn when typing working 燃烧 打字'],
    [t('settings.fire.colorBox'), t('settings.find.colorBox'), 'border rim colour box 边框 颜色'],
    [t('settings.fire.style'), undefined, 'fire style look 风格 样式'],
  ]),
  group('fire', t('settings.fire.whileTyping'), t('settings.find.whileTyping'), 'typing timing speed 打字 速度'),
  group('fire', t('settings.fire.flames'), t('settings.find.flames'), 'flames height size speed 火焰 高度 速度'),
  ...rows('fire', t('settings.fire.extras'), [
    [t('settings.fire.flare'), t('settings.find.flare'), 'temper flare fast typing 打字 发火'],
    [t('settings.fire.asYouType'), t('settings.fire.asYouTypeDetail'), 'confetti sparks particles caret 彩纸 火花 粒子'],
    [t('settings.fire.popDelete'), t('settings.find.popDelete'), 'delete pixels burst backspace 删除 像素'],
  ]),
  group('fire', t('settings.fire.colors'), t('settings.find.fireColors'), 'colours palette fire colors 颜色 配色'),

  // Menu bar
  group('menubar', t('settings.common.startFrom'), t('settings.find.menubarPresets'), 'preset icon 预设 图标'),
  ...rows('menubar', t('settings.menubar.number'), [
    [t('settings.menubar.counts'), t('settings.find.counts'), 'badge count number 角标 数字 计数'],
    [t('settings.menubar.readsAs'), t('settings.menubar.readsAsDetail'), 'badge number format 角标 数字'],
  ]),
  ...rows('menubar', t('settings.menubar.spout'), [
    [t('settings.menubar.whenSpouts'), undefined, 'whale spout animation 鲸鱼 喷水 动画'],
    [t('settings.menubar.tryIt'), undefined, 'test preview spout 试试 预览'],
  ]),

  // Environment
  ...rows('environment', undefined, [[t('settings.env.variablesFor'), t('settings.find.variablesFor'), 'env variables scope project api keys 变量 项目 密钥']]),
  ...rows('environment', t('settings.env.worktrees'), [[t('settings.env.newKeys'), t('settings.find.newKeys'), '.env worktree keys 工作树']]),
  ...rows('environment', t('settings.agent.yourAgent'), [[t('settings.env.readEnv'), t('settings.find.readEnv'), 'dotenv secrets read env files 机密 读取']]),
  ...rows('environment', t('settings.env.database'), [[t('settings.env.postgres'), t('settings.find.postgres'), 'postgres database sql supabase database url 数据库']]),

  // People & access
  ...rows('people', t('settings.people.friends'), [
    [t('settings.people.direct'), t('settings.find.direct'), 'network p2p peer friends online 网络 好友 在线'],
    [t('settings.people.addAFriend'), undefined, 'friend invite code link qr 好友 邀请 二维码'],
    [t('settings.people.whoCanAsk'), undefined, 'chats ask agent permission 聊天 权限'],
    [t('settings.people.whoSeesUsage'), undefined, 'usage limits privacy share 用量 隐私 共享'],
    [t('network.settings.seen'), t('settings.find.seen'), 'seen read receipts delivered privacy 已读 回执 送达 隐私'],
  ]),
  group('people', t('settings.people.capabilities'), t('settings.find.capabilities'), 'trust capabilities permissions access folders ask me for 信任 权限 文件夹'),
  group('people', t('settings.people.rules'), t('settings.find.rules'), 'rules allow always decline 规则 允许 拒绝'),
  group('people', t('settings.people.room'), t('settings.find.room'), 'peers trust room people 房间 信任'),
  group('people', t('settings.people.remembered'), t('settings.find.remembered'), 'forget trust remembered 忘掉 信任'),
  ...rows('people', t('settings.people.remote'), [
    [t('settings.people.reach'), t('settings.find.reach'), 'tunnel tailscale cloudflare ngrok relay remote 隧道 远程 中继'],
    [t('settings.people.takeNew'), t('settings.find.takeNew'), 'room open closed join knock 房间 开放 加入 敲门'],
    [t('settings.people.invite'), undefined, 'invite copy link new link 邀请 链接 复制'],
  ]),

  // External agents
  ...rows('external', undefined, [
    [t('more.ext.connect'), t('more.ext.find.connect'), 'mcp server listener on off 外部 连接 服务器 开关'],
    [t('more.ext.pause'), t('more.ext.pauseDetail'), 'pause refuse 暂停 拒绝'],
    [t('more.ext.mcpUrl'), t('more.ext.find.mcpUrl'), 'url copy address 地址 复制 链接'],
  ]),
  group('external', t('more.ext.connectGroup'), t('more.ext.find.connectGroup'), 'pair pairing code connect 配对 配对码 连接'),
  ...rows('external', t('more.ext.connectGroup'), [
    [t('more.ext.outside'), t('more.ext.find.outside'), 'remote hosted tailscale public 远程 托管 公网'],
    [t('more.ext.mayDo'), t('more.ext.find.mayDo'), 'level trust 级别 信任'],
    [t('more.ext.fullForCode'), t('more.ext.find.full'), 'remote full warning 远程 完全信任 警告'],
    [t('more.ext.allProjects'), t('more.ext.find.allProjects'), 'projects reach scope 项目 范围 访问'],
    [t('more.ext.standalone'), t('more.ext.find.standalone'), 'chats standalone 聊天 独立'],
    [t('more.ext.dms'), t('more.ext.find.dms'), 'dm messages friends 私信 消息 好友'],
    [t('more.ext.groups'), t('more.ext.find.groups'), 'groups 群组'],
    [t('more.ext.code'), t('more.ext.find.code'), 'code 配对码'],
  ]),
  group('external', t('more.ext.connected'), t('more.ext.find.connected'), 'revoke stop agents grants 撤销 停止 授权'),
  ...rows('external', t('more.ext.connected'), [[t('more.ext.stopAll'), t('more.ext.find.stopAll'), 'stop all 全部停止']]),
  group('external', t('more.ext.activity'), t('more.ext.showDetail'), 'audit log activity 审计 日志 动态'),
  ...rows('external', t('more.ext.activity'), [[t('more.ext.showLabel'), t('more.ext.find.show'), 'filter 筛选']]),

  // Phone
  group('computers', t('settings.computers.whereTitle'), t('settings.find.whereRuns'), 'run new work machine best available 运行 新工作 电脑 最合适的'),
  ...rows('computers', t('settings.computers.whereTitle'), [[t('settings.computers.runOn'), t('settings.find.runOn'), 'here best available machine computer 这里 最合适的 电脑']]),
  group('computers', t('settings.computers.you'), t('settings.find.youOnNetwork'), 'always on identity network friends move stand in standing in mac mini server 身份 网络 好友 迁移 暂代 服务器'),
  group('computers', t('settings.computers.envAlways'), t('settings.find.envAlways'), 'env dotenv secrets ask again always 密钥 重新询问 始终'),
  ...rows('computers', t('settings.computers.settings'), [[t('settings.computers.settingsEvery'), t('settings.find.settingsEvery'), 'sync settings conflicts same everywhere secrets keep in sync 同步 设置 冲突 密钥']]),
  group('computers', t('settings.computers.yours'), t('settings.find.yourComputers'), 'add ssh link code fingerprint rename icon forget update health 添加 链接 代码 指纹 重命名 图标 忘掉 更新'),
  group('phone', t('settings.phone.cable'), t('settings.find.cable'), 'usb cable adb plugged 数据线'),
  group('phone', t('settings.phone.yourPhones'), t('settings.find.yourPhones'), 'devices paired remove 设备 配对 移除'),
  ...rows('phone', undefined, [
    [t('settings.phone.wifi'), t('settings.find.wifi'), 'wifi wi-fi network lan 无线 网络 局域网'],
    [t('settings.phone.otherNetworks'), t('settings.find.otherNetworks'), 'relay remote away cellular 中继 远程 蜂窝'],
  ]),
  group('phone', t('settings.phone.control'), t('settings.find.phoneControl'), 'adb control android automation 控制 自动化'),
  ...rows('phone', t('settings.phone.control'), [
    [t('settings.phone.howItWorks'), undefined, 'phone agent control 手机 控制'],
    [t('settings.phone.useThisPhone'), undefined, 'phone agent control allow 手机 控制 允许'],
    [t('settings.phone.wireless'), t('settings.find.wireless'), 'adb wireless debugging developer 无线调试 开发者'],
    ['Beluga Link', t('settings.find.belugaLink'), 'accessibility link app 无障碍 应用'],
  ]),
  group('phone', t('settings.phone.pair'), t('settings.find.pair'), 'pair qr code android iphone companion app 配对 二维码'),
  ...rows('phone', t('settings.phone.pair'), [[t('settings.about.app'), t('settings.find.phoneApp'), 'app download install 下载 安装']]),

  // Voice
  ...rows('voice', t('settings.voice.writing'), [
    [t('settings.voice.mic'), t('settings.find.mic'), 'microphone mic input device airpods headset usb 麦克风 耳机'],
    [t('settings.voice.model'), t('settings.find.voiceModel'), 'whisper parakeet speech model transcribe 模型 转写'],
    [t('settings.voice.language'), t('settings.find.voiceLanguage'), 'language english turkish auto 语言'],
  ]),
  ...rows('voice', t('settings.voice.talk'), [
    [t('settings.voice.shortcut'), t('settings.find.talkShortcut'), 'talk push to talk hotkey key 按住说话 快捷键'],
    [t('settings.voice.anyApp'), t('settings.find.anyApp'), 'global system wide anywhere 全局 任何应用'],
    [t('settings.voice.sendNow'), t('settings.find.sendNow'), 'auto send message 自动发送'],
  ]),

  // Advanced
  ...rows('advanced', t('settings.web.title'), [
    [t('settings.web.open'), t('settings.find.webOpen'), 'web browser remote access 浏览器 远程'],
    [t('settings.web.reached'), t('settings.find.webReached'), 'local network tunnel internet 本地 网络 隧道'],
    [t('settings.web.address'), t('settings.find.webAddress'), 'url address link 地址 链接'],
    [t('settings.web.letIn'), t('settings.find.webLetIn'), 'link browser login 链接 浏览器 登录'],
  ]),
  ...rows('advanced', t('settings.threads.title'), [[t('settings.threads.let'), t('settings.find.threads'), 'threads child sub-agent family orchestrate 线程 子聊天']]),

  // Experimental: one group per experiment, its switch the row (made from shared/experiments.ts).
  ...EXPERIMENTS.flatMap((id) => rows('experimental', tl('EXPERIMENT_INFO', id, 'title', EXPERIMENT_INFO[id].title), [[tl('EXPERIMENT_INFO', id, 'title', EXPERIMENT_INFO[id].title), tl('EXPERIMENT_INFO', id, 'summary', EXPERIMENT_INFO[id].summary), `${id} experimental early ${EXPERIMENT_INFO[id].keywords} 实验`]])),

  // About
  ...rows('about', undefined, [
    [t('settings.about.app'), t('settings.find.appVersion'), 'version build 版本'],
    [t('settings.updates.title'), t('settings.find.aboutUpdates'), 'update upgrade version check now 更新 版本'],
    [t('settings.about.daemon'), t('settings.find.daemon'), 'daemon version 后台 版本'],
    [t('settings.about.windows'), t('settings.about.windowsDetail'), 'clients windows 窗口'],
    [t('settings.about.log'), '~/.beluga/logs/daemon.log', 'logs console daemon log debug 日志 调试'],
    [t('settings.about.report'), undefined, 'bug report issue feedback 反馈 问题 报告'],
  ]),
  ...rows('about', t('settings.about.support'), [[t('settings.about.free'), t('settings.find.support'), 'donate star github coffee support sponsor 捐助 咖啡 支持 赞助']]),
];
