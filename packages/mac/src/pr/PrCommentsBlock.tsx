import { t, useT } from '../i18n/index.js';
import { useMemo } from 'react';
import { parsePrCommentsRef } from '@beluga/shared/pr-comments-ref.js';
import { Icon } from '../components/Icon.js';
import { Button } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { ItemCard } from './PrConversation.js';
import { conversationCounts, openPrPage, timeline, usePrConversation } from './use-pr-conversation.js';
import s from './pr-conversation.module.css';

/** The most a message shows; the rest is on the PR's page. */
const MAX_ITEMS = 12;

/**
 * A ```beluga-pr-comments block (shared/pr-comments-ref.ts) in a worktree's chat: its PR's
 * comments as cards, read-only; a file's path goes to that line. Answering is the PR's page, one
 * click away.
 */
export function PrCommentsBlock({ code }: { code: string }) {
  const ref = useMemo(() => parsePrCommentsRef(code), [code]);
  const wsId = useApp((st) => (st.view.kind === 'workspace' ? st.view.id : undefined));
  const pr = useApp((st) => (wsId ? st.prs[wsId] : undefined));
  useT();
  if (!wsId || !pr) return <div className={s.chatNote}>{t('pr.block.note')}</div>;
  return <Comments wsId={wsId} show={ref.show} {...(ref.path ? { path: ref.path } : {})} />;
}

function Comments({ wsId, show, path }: { wsId: string; show: 'open' | 'all'; path?: string }) {
  const pr = useApp((st) => st.prs[wsId])!;
  const { data, error, loading } = usePrConversation(wsId);
  useT();
  const items = data
    ? timeline(data).filter((i) => {
        if (i.kind !== 'thread') return !path;
        if (path && !i.thread.path.startsWith(path)) return false;
        return show === 'all' || !i.thread.resolved;
      })
    : [];
  const counts = conversationCounts(data);
  return (
    <figure className={s.chatBlock} data-pr-comments-block={pr.number}>
      <figcaption className={s.chatHead}>
        <Icon name="pr" size={13} />
        <strong>#{pr.number}</strong>
        <span className={s.chatTitle}>{pr.title}</span>
        <span className={s.grow} />
        <span className={s.when}>{data ? (counts.open ? t('pr.nOpenThreads', { n: counts.open }) : t('issues.model.comments', { n: counts.said })) : loading ? t('pr.reading') : ''}</span>
        <Button size="small" icon="chat" onClick={() => openPrPage(wsId)}>
          {t('pr.block.reply')}
        </Button>
      </figcaption>
      <div className={s.chatItems}>
        {error && !data ? <div className={s.problem}>{error}</div> : null}
        {data && !items.length ? <div className={s.empty}>{show === 'open' ? t('pr.block.nothingOpen') : t('pr.block.noComments')}</div> : null}
        {items.slice(0, MAX_ITEMS).map((item) => (
          <ItemCard key={item.id} wsId={wsId} item={item} />
        ))}
        {items.length > MAX_ITEMS ? (
          <button type="button" className={s.more} onClick={() => openPrPage(wsId)}>
            {t('pr.block.more', { n: items.length - MAX_ITEMS })}
          </button>
        ) : null}
      </div>
    </figure>
  );
}
