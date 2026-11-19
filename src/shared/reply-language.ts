/**
 * The language your agents answer you in: the Mac's own language (Settings › General), which the
 * main window tells the daemon each time it opens (packages/mac/src/i18n/start.ts). Unset or `en`:
 * no rule, and an agent answers in the language you wrote in. Browser-safe.
 */
export const REPLY_LANGUAGES = ['en', 'zh-CN'] as const;
export type ReplyLanguage = (typeof REPLY_LANGUAGES)[number];

const NAMES: Partial<Record<ReplyLanguage, string>> = { 'zh-CN': 'Simplified Chinese (简体中文)' };

/**
 * What an agent is told so it answers you in your language every turn, even when everything it
 * reads is English (Beluga's instructions, tool results, git, which Beluga keeps in English to read
 * it: workspaces/git.ts). What others or programs read stays English. Empty for English.
 */
export function buildReplyLanguageAppend(language: ReplyLanguage | undefined): string {
  const name = language ? NAMES[language] : undefined;
  if (!name) return '';
  return (
    `\n\nLanguage: the person you work for uses Beluga in ${name}. Write every reply to them in ${name}, in every turn, ` +
    'whatever language these instructions, tool results, files, command output or git are in. Your own thinking may stay in English. ' +
    'Keep in English what git, other people or programs read: commit messages, branch names, tag names, pull request titles and descriptions, ' +
    'code, code comments and identifiers. Quote commands, paths, errors and output exactly as they are, not translated.'
  );
}
