import type { Lang } from './table';

/**
 * SS-98：应用内隐私说明，与 `docs/studio-privacy.md` 同一份内容（应用内为精简版，条目一一对应）。
 * 正文用 `\n\n` 分段，屏幕按空行拆成段落。
 */
export const zh = {
  'privacy.title': '隐私说明',
  'privacy.updated': '最后更新 2026-11-21 · 版本 1.0',
  'privacy.intro': '这份说明写清楚应用收集什么、为什么收集、存在哪里、什么时候删除，以及你能怎么处理。你是工作室的客户，数据由你的工作室与它的 Beluga 节点处理。',

  'privacy.dataTitle': '我们收集什么',
  'privacy.dataBody':
    '邮箱：登录与接收回执。\n' +
    '登录凭证：登录后中台签发的会话令牌，存在本机安全存储。\n' +
    '需求与附件：你写的需求、追问回答、语音转成的文字，以及你主动选择或拍摄的图片与文件。\n' +
    '设备：本机随机生成的设备标识、系统平台（iOS/Android）、推送令牌；签名私钥只在本机安全存储，不离开手机。\n' +
    '签名记录：你批准开工、通过交付、批准上线等动作与时间。',

  'privacy.notTitle': '我们不收集什么',
  'privacy.notBody':
    '不收集通讯录、位置、健康数据、短信、通话记录与剪贴板内容。\n' +
    '不读取相册全部内容：只在你选择附件时读取你选中的图片。\n' +
    '不在后台持续录音：麦克风只在你按住说话时使用，转写完成后不保留音频。\n' +
    '不做广告投放与用户画像，不向第三方出售或共享你的个人信息。',

  'privacy.useTitle': '用来做什么',
  'privacy.useBody':
    '完成你委托的需求：把需求与附件交给你的工作室的 Beluga 节点处理。\n' +
    '通知进展：待你确认、交付完成、上线结果，经系统推送提醒你。\n' +
    '签名与审计：记录谁在什么时候批准了什么，作为交付凭据。\n' +
    '排障与支持：在你要求时，用会话与需求编号定位问题。',

  'privacy.storeTitle': '存在哪里、怎么传输',
  'privacy.storeBody':
    '手机与中台之间使用 HTTPS / WSS 加密传输。\n' +
    '中台（Cloudflare）承载登录、需求转发与推送令牌，数据可能跨境处理。\n' +
    '需求与代码在你的工作室自己的 Beluga 节点上处理；本机的会话令牌与设备私钥存放在系统安全存储（iOS Keychain / Android Keystore）。',

  'privacy.keepTitle': '保留多久',
  'privacy.keepBody':
    '账号与需求：账号存续期间保留；你要求删除后，除法律要求保留的交付与签名记录外，在 30 天内清除。\n' +
    '推送令牌：关闭通知或退出登录时注销，注销失败的记录在下次登录时补删。\n' +
    '设备私钥：只在本机，卸载应用或移除设备即失效。\n' +
    '签名与交付记录：作为交付凭据与法律要求保留，具体期限由你的工作室与合同约定。',

  'privacy.permsTitle': '设备权限',
  'privacy.permsBody':
    '相机：扫描配对二维码、拍摄图片附件；不开也能从相册选图。\n' +
    '麦克风：录一段语音说明需求并转成文字；不开就打字提交。\n' +
    '相册：选择图片或设计稿作为附件。\n' +
    '通知：待你确认、交付完成时提醒；不开仍可在应用内看到。\n' +
    '权限可随时在系统设置里关闭，关闭后应用不会再做相应的采集。',

  'privacy.choicesTitle': '你的选择',
  'privacy.choicesBody':
    '查看与更正：邮箱、语言、外观在「我 › 账号」里查看与修改；需求内容可在需求详情里查看。\n' +
    '撤回同意：关闭系统权限即停止相应采集；关闭推送开关即注销本机令牌。\n' +
    '删除账号：手机端暂未开放删除入口，请联系你的工作室，或在桌面端操作。删除后按「保留多久」一节处理。',

  'privacy.contactTitle': '联系我们',
  'privacy.contactBody': '隐私问题、数据查询或删除请求：privacy@synon.studio。我们会在 15 个工作日内答复。',

  'privacy.changesTitle': '变更',
  'privacy.changesBody':
    '这份说明更新时，会同时更新应用内这一页，并在应用更新说明里写清楚改了什么。涉及新增收集类别时，会在使用前单独征得你的同意。',
} as const;

export type PrivacyStringKey = keyof typeof zh;

export const en: Record<PrivacyStringKey, string> = {
  'privacy.title': 'Privacy notice',
  'privacy.updated': 'Last updated 2026-11-21 · Version 1.0',
  'privacy.intro':
    'This notice explains what the app collects, why, where it is kept, when it is deleted, and what you can do about it. You are a studio customer; your data is handled by your studio and its Beluga node.',

  'privacy.dataTitle': 'What we collect',
  'privacy.dataBody':
    'Email: to sign in and receive receipts.\n' +
    'Sign-in credential: a session token issued by the hub after sign-in, kept in this device’s secure storage.\n' +
    'Requests and attachments: the requests you write, your answers, speech turned into text, and the images and files you choose or take.\n' +
    'Device: a random device id made on this phone, the platform (iOS/Android), a push token; your signing key stays in this device’s secure storage and never leaves it.\n' +
    'Signatures: which start, delivery or release you approved, and when.',

  'privacy.notTitle': 'What we do not collect',
  'privacy.notBody':
    'No contacts, location, health data, messages, call logs or clipboard.\n' +
    'No reading of your whole photo library: only the pictures you pick for an attachment.\n' +
    'No recording in the background: the microphone is used only while you hold to speak, and the audio is not kept after it becomes text.\n' +
    'No advertising, no profiling, and we never sell or share your personal information.',

  'privacy.useTitle': 'What it is for',
  'privacy.useBody':
    'Doing the work you ask for: your request and attachments go to your studio’s Beluga node.\n' +
    'Telling you progress: a decision needs you, a delivery is ready, a release finished.\n' +
    'Signing and audit: a record of who approved what, and when, as the delivery receipt.\n' +
    'Support: with your consent, finding a problem by its conversation or request.',

  'privacy.storeTitle': 'Where it is kept, how it travels',
  'privacy.storeBody':
    'The phone talks to the hub over HTTPS / WSS.\n' +
    'The hub (Cloudflare) carries sign-in, request forwarding and push tokens; data may be processed across borders.\n' +
    'Requests and code are handled on your studio’s own Beluga node; the session token and signing key are kept in system secure storage (iOS Keychain / Android Keystore).',

  'privacy.keepTitle': 'How long',
  'privacy.keepBody':
    'Account and requests: while your account exists; after you ask us to delete them they are cleared within 30 days, except delivery and signature records the law requires.\n' +
    'Push token: unregistered when you turn notifications off or sign out; a failed unregister is retried at the next sign-in.\n' +
    'Signing key: only on this device; uninstalling the app or removing the device ends it.\n' +
    'Delivery and signature records: kept as the delivery receipt and as the law requires; your studio and your contract set the term.',

  'privacy.permsTitle': 'Device permissions',
  'privacy.permsBody':
    'Camera: to scan a pairing code and take picture attachments; without it you can still pick from the library.\n' +
    'Microphone: to speak a request and turn it into text; without it you can type.\n' +
    'Photos: to attach pictures and design files.\n' +
    'Notifications: to tell you when a decision or delivery needs you; without it you can still see it in the app.\n' +
    'You can turn any permission off in system settings; the app then stops that collection.',

  'privacy.choicesTitle': 'Your choices',
  'privacy.choicesBody':
    'See and correct: email, language and appearance are under Me › Account; requests are in their detail pages.\n' +
    'Withdraw consent: turning off a system permission stops that collection; turning off push unregisters this device.\n' +
    'Delete your account: not available on mobile yet; contact your studio or use the desktop app. Deletion then follows “How long”.',

  'privacy.contactTitle': 'Contact',
  'privacy.contactBody':
    'Privacy questions, data access or deletion: privacy@synon.studio. We answer within 15 business days.',

  'privacy.changesTitle': 'Changes',
  'privacy.changesBody':
    'When this notice changes, this page and the app’s update notes change with it. A new kind of data is only collected after you agree to it.',
};

const table: Record<Lang, Record<PrivacyStringKey, string>> = { zh, en };

export function tPrivacy(
  lang: Lang,
  key: PrivacyStringKey,
  vars?: Record<string, string | number>,
): string {
  const text = table[lang][key] ?? table.zh[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
