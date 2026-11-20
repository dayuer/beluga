import type { Lang } from './table.js';

export const zh = {
  'join.title': '登记这台设备',
  'join.subtitle': '核对节点指纹后，这台手机将生成专属密钥并完成登记。',
  'join.invalidLink': '邀请链接不完整或格式不对，请向搭环境的人重新索取。',
  'join.errUsed': '这个一次性邀请码已经用过了。每条邀请链接只能登记一台设备，请向搭环境的人重新获取。',
  'join.errExpired': '这条邀请链接已过期（超过 7 天有效期），请让搭环境的人重新生成一条。',
  'join.errFingerprint': '节点返回的指纹与链接里的不一致，已中止登记。请勿继续，并立即联系搭环境的人核实。',
  'join.errOffline': '当前没有网络连接，连上网后再试一次。',
  'join.errWaiting': '等待执行机器上线：邀请码还没用掉，机器回来后再点一次「登记」。',
  'join.errFailed': '登记没能完成，请稍后再试，或联系搭环境的人。',
  'join.backHome': '返回首页',

  'fp.title': '核对节点指纹',
  'fp.hint': '请对照搭环境的人给你的纸条或消息，确认下面 4 组短码完全一致：',
  'fp.actionHint': '核对一致后写入公钥',
  'fp.match': '登记',
  'fp.mismatch': '不一样',
  'fp.mismatchTitle': '指纹不一致，已暂停登记',
  'fp.mismatchBody':
    '这可能是链接被篡改，或对方重新初始化了节点。\n\n请不要继续登记，立即联系搭环境的人核实，并请对方重新发送一条新的邀请链接。',
  'fp.mismatchRetry': '重新核对',

  'add.title': '扫码加设备',
  'add.checkingPermission': '正在检查相机权限…',
  'add.cameraTitle': '需要相机权限才能扫码',
  'add.cameraAskHint': '请允许使用相机，以扫描桌面端显示的设备邀请二维码。',
  'add.cameraDeniedHint': '相机权限已被拒绝。请前往系统设置开启本应用的相机权限后再回来扫码。',
  'add.allowCamera': '允许相机',
  'add.openSettings': '打开设置',
  'add.scanHint': '将镜头对准桌面端「加一台设备」出示的二维码：',
  'add.invalidQr': '这不是有效的设备邀请二维码，请对准桌面端显示的二维码重试。',
  'add.rescan': '重新扫码',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'join.title': 'Enroll this device',
  'join.subtitle': 'Verify the node fingerprint below to generate a device key and finish enrollment.',
  'join.invalidLink': 'This invite link is incomplete or invalid. Ask your administrator for a new one.',
  'join.errUsed': 'This one-time invite code has already been used. Ask your administrator for a new link.',
  'join.errExpired': 'This invite link has expired (valid for 7 days). Ask your administrator for a new one.',
  'join.errFingerprint': 'The node fingerprint did not match the invite link. Enrollment was aborted — contact your administrator.',
  'join.errOffline': 'You are offline. Reconnect and try again.',
  'join.errWaiting': 'Waiting for the node to come online — the invite is not used yet. Tap Enroll again once it is back.',
  'join.errFailed': 'Enrollment failed. Try again shortly or contact your administrator.',
  'join.backHome': 'Back to home',

  'fp.title': 'Verify node fingerprint',
  'fp.hint': 'Compare these 4 short codes with the note or message from your administrator:',
  'fp.actionHint': 'Enrolls this device',
  'fp.match': 'Enroll',
  'fp.mismatch': 'Mismatch',
  'fp.mismatchTitle': 'Fingerprint mismatch — paused',
  'fp.mismatchBody':
    'The link may have been tampered with, or the node was re-initialized.\n\nDo not continue. Contact your administrator to verify and request a new invite link.',
  'fp.mismatchRetry': 'Check again',

  'add.title': 'Scan to add device',
  'add.checkingPermission': 'Checking camera permission…',
  'add.cameraTitle': 'Camera access needed',
  'add.cameraAskHint': 'Allow camera access to scan the invite QR code shown on your desktop.',
  'add.cameraDeniedHint': 'Camera permission was denied. Enable Camera in system Settings and come back.',
  'add.allowCamera': 'Allow camera',
  'add.openSettings': 'Open Settings',
  'add.scanHint': 'Point your camera at the invite QR code on your desktop:',
  'add.invalidQr': 'Not a valid device invite QR code. Point the camera at the QR code shown on desktop.',
  'add.rescan': 'Scan again',
};

export type JoinStringKey = keyof typeof zh;

export function joinT(lang: Lang, key: JoinStringKey): string {
  return lang === 'en' ? en[key] : zh[key];
}
