import { useT } from '../i18n/index.js';
import { memo, useEffect, useRef } from 'react';
import type { CcAgent, CcSession } from '@beluga/core/claude-code/model.js';
import { useNow } from '../chat/Items.js';
import { StepWords } from '../chat/steps/StepRow.js';
import { Icon } from '../components/Icon.js';
import { Dot, cx } from '../components/ui.js';
import { agentElapsed, agentLabel, agentTone, plural, sessionLabel, tokens, typeLabel } from './cc-model.js';
import s from './claude-code.module.css';

/** A sub-agent at a glance: what it's for, its kind, status, what it's doing, for how long. */
export const AgentCard = memo(function AgentCard({ agent, selected, compact, onOpen }: { agent: CcAgent; selected?: boolean; compact?: boolean; onOpen: () => void }) {
  const t = useT();
  const running = agent.status === 'running';
  const now = useNow(running);
  const tone = agentTone(agent);
  const ref = useRef<HTMLButtonElement>(null);
  // The chosen agent in a row of cards: scrolled into sight.
  useEffect(() => {
    if (selected && compact) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected, compact]);
  return (
    <button
      ref={ref}
      type="button"
      className={cx(s.card, compact && s.cardCompact, selected && s.cardSelected, running && s.cardLive)}
      onClick={onOpen}
      aria-pressed={selected}
      title={t('claudeCode.cards.openAgent')}
      aria-label={`${agent.description}, ${agentLabel(agent)}${agent.step ? `, ${agent.step}` : ''}`}
    >
      <span className={s.cardTop}>
        <span className={s.typeBadge}>{typeLabel(agent.type)}</span>
        {/* Named agents can be messaged by that name (SendMessage). */}
        {agent.name ? <span className={s.typeBadge}>@{agent.name}</span> : null}
        {agent.background ? null : <span className={s.typeBadge}>{t('claudeCode.cards.foreground')}</span>}
        <span className={cx(s.cardStatus, s[`tone_${tone}`])}>
          {running ? <Dot tone="subagent" live /> : <Icon name={agent.status === 'failed' ? 'x' : agent.status === 'finished' ? 'check' : agent.status === 'idle' ? 'clock' : 'stop'} size={10} />}
          {agentLabel(agent)}
        </span>
      </span>
      <span className={s.cardTitle}>{agent.description}</span>
      <span className={s.cardStep}>{agent.step ? <StepWords words={agent.step} /> : running ? t('claudeCode.cards.starting') : '—'}</span>
      {compact ? null : (
        <span className={s.cardMeta}>
          <span>{agentElapsed(agent, now)}</span>
          <span>{t('claudeCode.monitor.nSteps', { n: agent.steps })}</span>
          {agent.tokens ? <span>{t('claudeCode.monitor.context', { n: tokens(agent.tokens) })}</span> : null}
        </span>
      )}
    </button>
  );
});

/** The session's own transcript, as the first card in a row of its agents. */
export function SessionChip({ session, selected, onOpen }: { session: CcSession; selected: boolean; onOpen: () => void }) {
  const t = useT();
  const now = useNow(session.status === 'working', 5000);
  const st = sessionLabel(session, now);
  return (
    <button type="button" className={cx(s.card, s.cardCompact, s.cardSession, selected && s.cardSelected)} onClick={onOpen} aria-pressed={selected} aria-label={t('claudeCode.cards.mainLabel', { state: st.label })}>
      <span className={s.cardTop}>
        <span className={s.typeBadge}>{t('claudeCode.cards.main')}</span>
        <span className={cx(s.cardStatus, s[`tone_${st.tone}`])}>
          {session.status === 'working' ? <Dot tone="claude" live /> : null}
          {st.label}
        </span>
      </span>
      <span className={s.cardTitle}>{t('claudeCode.cards.conversation')}</span>
      <span className={s.cardStep}>{session.step ? <StepWords words={session.step} /> : '—'}</span>
    </button>
  );
}
