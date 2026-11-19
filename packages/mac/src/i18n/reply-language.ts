import { useEffect } from 'react';
import type { ReplyLanguage } from '@beluga/shared/reply-language.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { locale } from './index.js';

/**
 * Your agents answer you in this window's language (Settings › General): the main window tells the
 * daemon whenever the two differ, so a run's instructions say so (src/shared/reply-language.ts).
 * English clears it: an agent then answers in the language you wrote in.
 */
export function useReplyLanguage(): void {
  const { client } = useBeluga();
  const saved = useApp((st) => st.prefs.replyLanguage);
  useEffect(() => {
    const want: ReplyLanguage | undefined = locale() === 'en' ? undefined : locale();
    if (saved === want) return;
    void client.api.session.setPrefs({ replyLanguage: want ?? null }).catch((e: unknown) => console.warn('[i18n] agents may not answer in this language:', e));
  }, [client, saved]);
}
