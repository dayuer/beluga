import type { Lang } from './table';

export const zh = {
  'voice.micLabel': '语音输入',
  'voice.cancelLabel': '取消语音输入',
  'voice.stopLabel': '完成语音输入',
  'voice.micDenied': '未开启麦克风权限。请在系统「设置 › Synon Studio › 麦克风」中允许访问，或使用系统键盘听写。',
  'voice.speechDeniedIos': '未开启语音识别权限。请在系统「设置 › Synon Studio › 语音识别」中允许访问。',
  'voice.unavailable': '当前构建未包含语音识别模块，请使用系统键盘听写。',
} as const;

export type VoiceStringKey = keyof typeof zh;

export const en: Record<VoiceStringKey, string> = {
  'voice.micLabel': 'Voice input',
  'voice.cancelLabel': 'Cancel voice input',
  'voice.stopLabel': 'Finish voice input',
  'voice.micDenied': 'Microphone permission is off. Enable it in Settings › Synon Studio › Microphone, or use keyboard dictation.',
  'voice.speechDeniedIos': 'Speech recognition permission is off. Enable it in Settings › Synon Studio › Speech Recognition.',
  'voice.unavailable': 'Voice recognition module is not installed in this build; use keyboard dictation.',
};

const table: Record<Lang, Record<VoiceStringKey, string>> = { zh, en };

export function tVoice(lang: Lang, key: VoiceStringKey): string {
  return table[lang][key] ?? table.zh[key];
}
