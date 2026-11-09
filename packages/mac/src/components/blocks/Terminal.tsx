import { type CSSProperties, memo, useMemo, useState } from 'react';
import { type Span, TERMINAL_FOLD, readTerminal } from '@beluga/shared/render/terminal.js';
import { ActionsContext, type ActionItem } from '../SpecMenu.js';
import { Icon } from '../Icon.js';
import { cx } from '../ui.js';
import { copyText } from '../../lib/copy.js';
import { toast, useBeluga } from '../../lib/beluga.js';
import { useCopied } from '../markdown/CodeBlock.js';
import b from './blocks.module.css';
import { useT } from '../../i18n/index.js';

/**
 * A terminal session Claude showed (a command and what it printed, a log, ANSI colors): drawn as
 * a soft, slightly sunken terminal. Prompts are quiet and commands stand out; ANSI colors come
 * from a soft palette (light and dark); errors and warnings get a faint tint; long output shows
 * its last lines first. Copy on hover; right-click for the commands, wrapping and quoting.
 */

/** Fences that just say "a shell": no need to name them. */
const GENERIC = /^(|console|terminal|term|shell|sh|bash|zsh|shell-session|sh-session|shellsession|bash-session|zsh-session|text|txt|plain|plaintext|output|stdout|ansi)$/;

const color = (c: Span['fg']): string | undefined => (c ? (c.startsWith('#') ? c : `var(--ansi-${c})`) : undefined);

function styleOf(s: Span): CSSProperties | undefined {
  if (!s.fg && !s.bg && !s.bold && !s.dim && !s.italic && !s.underline) return undefined;
  return {
    ...(s.fg ? { color: color(s.fg) } : {}),
    ...(s.bg ? { background: color(s.bg), borderRadius: 2 } : {}),
    ...(s.bold ? { fontWeight: 600 } : {}),
    ...(s.dim ? { opacity: 0.62 } : {}),
    ...(s.italic ? { fontStyle: 'italic' } : {}),
    ...(s.underline ? { textDecoration: 'underline' } : {}),
  };
}

function Spans({ spans }: { spans: readonly Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        const style = styleOf(s);
        return style ? (
          <span key={i} style={style}>
            {s.text}
          </span>
        ) : (
          s.text
        );
      })}
    </>
  );
}

export const Terminal = memo(function Terminal({ code, lang, onQuote }: { code: string; lang?: string | undefined; onQuote?: ((fence: string) => void) | undefined }) {
  const { client } = useBeluga();
  const t = useT();
  const term = useMemo(() => readTerminal(code), [code]);
  const [wrap, setWrap] = useState(false);
  const [all, setAll] = useState(false);
  const [copied, copyNow] = useCopied();
  const copy = (text: string, what: string): void => void copyText(text).then(() => toast(client, t('common.blocks.copied', { what }), 'success'));
  const hidden = all ? 0 : Math.max(0, term.lines.length - TERMINAL_FOLD);
  const shown = hidden ? term.lines.slice(hidden) : term.lines;
  const name = (lang ?? '').toLowerCase();
  const items: ActionItem[] = [
    { label: t('common.terminal.copyOutput'), icon: 'copy', onSelect: () => copy(term.copy, t('common.terminal.theOutput')) },
    ...(term.commands.length ? [{ label: term.commands.length === 1 ? t('common.terminal.copyCommand') : t('common.terminal.copyCommands'), icon: 'terminal' as const, onSelect: () => copy(term.commands.join('\n'), term.commands.length === 1 ? t('common.terminal.theCommand') : t('common.terminal.theCommands')) }] : []),
    { label: t('common.terminal.wrap'), icon: 'wrap', separate: true, checked: wrap, onSelect: () => setWrap(!wrap) },
    ...(hidden ? [{ label: t('common.terminal.showAll', { n: term.lines.length }), onSelect: () => setAll(true) }] : []),
    ...(onQuote ? [{ label: t('common.blocks.quote'), icon: 'chat' as const, separate: true, onSelect: () => onQuote(`\`\`\`${lang ?? 'console'}\n${term.plain}\n\`\`\``) }] : []),
  ];
  return (
    <ActionsContext items={items}>
      <div className={cx(b.block, b.term, wrap && b.wrap)} data-block="terminal">
        <div className={b.termHead}>
          <span className={b.termChip}>
            <Icon name="terminal" size={12} />
            {GENERIC.test(name) ? t('common.terminal.terminal') : name}
          </span>
          {term.commands.length > 1 ? <span>{t('common.terminal.nCommands', { n: term.commands.length })}</span> : null}
        </div>
        <div className={b.tools}>
          <button type="button" className={b.tool} aria-label={t('common.terminal.copyTheOutput')} onClick={() => copyNow(term.copy)}>
            <Icon name={copied ? 'check' : 'copy'} size={12} />
            {copied ? t('common.ui.copied') : t('common.ui.copy')}
          </button>
        </div>
        {hidden ? (
          <button type="button" className={cx(b.moreRow, b.termMore)} onClick={() => setAll(true)}>
            <Icon name="chevronUp" size={11} />
            {t('common.terminal.showEarlier', { n: hidden })}
          </button>
        ) : null}
        <pre className={b.termBody}>
          <code>
            {shown.map((line, i) => (
              <span key={hidden + i} className={b.termLine} data-kind={line.kind}>
                {line.kind === 'prompt' ? (
                  <>
                    <span className={b.prompt}>{line.prompt}</span>
                    <span className={b.command}>
                      <Spans spans={line.spans} />
                    </span>
                  </>
                ) : (
                  <Spans spans={line.spans} />
                )}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </ActionsContext>
  );
});
