import { useEffect, useRef } from 'react';
import type { ReplyLanguage } from '@beluga/shared/reply-language.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { locale } from './index.js';

/**
 * Your agents answer you in this window's language (Settings › General): the main window tells the
 * daemon when the two differ, so a run's instructions say so (src/shared/reply-language.ts).
 * English clears it: an agent then answers in the language you wrote in. Once per window: another
 * window in another language on the same daemon then has the last word, and the two never trade
 * it back and forth. Changing the language reloads the window, which tells it again.
 */
export function useReplyLanguage(): void {
  const { client } = useBeluga();
  const saved = useApp((st) => st.prefs.replyLanguage);
  const told = useRef(false);
  useEffect(() => {
    if (told.current) return;
    const want: ReplyLanguage | undefined = locale() === 'en' ? undefined : locale();
    if (saved === want) return;
    told.current = true;
    void client.api.session.setPrefs({ replyLanguage: want ?? null }).catch((e: unknown) => console.warn('[i18n] agents may not answer in this language:', e));
  }, [client, saved]);
}
