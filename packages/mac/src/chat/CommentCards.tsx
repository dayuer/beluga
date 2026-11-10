import { Icon } from '../components/Icon.js';
import { type DiffComment, commentWhere, removeComment } from '../views/diff-comments.js';
import { useWaitingComments } from '../views/DiffComment.js';
import s from './composer.module.css';
import { useT } from '../i18n/index.js';

/** The first changed line a comment is on (else its first line), sign and all, for its card; blank lines skipped. */
function firstLine(c: DiffComment): string {
  const said = c.code.filter((l) => l.slice(1).trim());
  return said.find((l) => l[0] === '+' || l[0] === '-') ?? said[0] ?? '';
}

/**
 * Comments on the changes (views/DiffComment.tsx) waiting above the message box: each a card with
 * where it is, the line it's on and what you said. They go after your words when you send.
 */
export function CommentCards({ box }: { box: string }) {
  const t = useT();
  const comments = useWaitingComments(box);
  if (!comments.length) return null;
  return (
    <div className={s.commentCards} role="list" aria-label={t('more.up.comment.cards')}>
      {comments.map((c) => {
        const where = c.side === 'new' ? commentWhere(c) : t(c.to !== c.from ? 'more.up.comment.removedLines' : 'more.up.comment.removedLine', { path: c.path, span: c.to !== c.from ? `${c.from}-${c.to}` : `${c.from}` });
        const line = firstLine(c);
        return (
          <div key={c.id} role="listitem" className={s.commentCard} aria-label={t('more.up.comment.on', { where })}>
            <div className={s.commentHead}>
              <Icon name="chat" size={11} />
              <span className={s.commentWhere} title={where}>
                {where}
              </span>
              <button type="button" aria-label={t('more.up.comment.remove', { where })} onClick={() => removeComment(box, c.id)}>
                <Icon name="x" size={9} />
              </button>
            </div>
            {line ? (
              <div className={s.commentCode} data-sign={line[0]}>
                {line.slice(1).trim()}
              </div>
            ) : null}
            <div className={s.commentSaid}>{c.text}</div>
          </div>
        );
      })}
    </div>
  );
}
