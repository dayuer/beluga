import { useState } from 'react';
import type { Template } from '@beluga/core/work-store.js';
import { Alert } from '../../components/Alert.js';
import { Checkbox, Field, FormSheet, TextArea, TextInput, formStyles as f } from '../../components/FormSheet.js';
import { Icon } from '../../components/Icon.js';
import { useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { openSheet } from '../../lib/sheets.js';
import type { NativeMenuProps } from './index.js';
import { usePick } from './pick.js';
import s from './menus.module.css';
import { useT } from '../../i18n/index.js';

/** A template's prompt with its blanks (two spaces, ": .", "# ", a trailing space) shown as "…". */
export const withBlanks = (prompt: string): string =>
  prompt
    .replace(/: \./, ': …')
    .replace(/ {2}/, ' … ')
    .replace(/# /, '#… ')
    .replace(/ $/, ' …')
    .trim() || '…';

/** Using a template is the same option whichever way the list is open. */
const PICKER = { kind: 'templates' } as const;

/**
 * Templates: click one to start from it (it fills the message box, ready to finish and send).
 * In "manage" your own ones can be removed; New Template… makes one.
 */
export function TemplatesSheet({ menu, close }: NativeMenuProps<'templates'>) {
  const t = useT();
  const { ui } = useBeluga();
  const pick = usePick(menu);
  const use = usePick(PICKER);
  const templates = useApp((st) => st.templates);
  const [removing, setRemoving] = useState<Template>();
  const manage = Boolean(menu.manage);
  if (removing) {
    return (
      <Alert
        icon="wand"
        tone="caution"
        title={t('dialogs.templates.removeTitle', { name: removing.name })}
        message={t('dialogs.templates.removeMessage')}
        confirm={{ label: t('dialogs.templates.remove'), destructive: true, onClick: () => (setRemoving(undefined), pick(`tpl-del:${removing.id}`)) }}
        onCancel={() => setRemoving(undefined)}
      />
    );
  }
  const footer = (
    <>
      <button type="button" className={f.linkButton} onClick={() => (close(), openSheet({ kind: 'template' }))}>
        {t('dialogs.templates.new')}
      </button>
      {manage ? null : (
        <button type="button" className={f.linkButton} onClick={() => ui.openMenu({ kind: 'templates', manage: true })}>
          {t('dialogs.templates.manage')}
        </button>
      )}
    </>
  );
  return (
    <FormSheet
      title={manage ? t('dialogs.templates.templates') : t('dialogs.templates.startFrom')}
      icon="wand"
      intro={manage ? t('dialogs.templates.introManage') : t('dialogs.templates.intro')}
      submitLabel=""
      hideSubmit
      cancelLabel={manage ? t('dialogs.templates.done') : t('dialogs.templates.cancel')}
      onSubmit={() => undefined}
      onCancel={close}
      footer={footer}
      width={560}
    >
      <div className={s.templates} role="list" aria-label={t('dialogs.templates.templates')}>
        {templates.map((tpl) => (
          <div key={tpl.id} role="listitem" style={{ display: 'flex', alignItems: 'flex-start' }}>
            <button type="button" className={s.template} onClick={() => use(`tpl:${tpl.id}`)} data-autofocus={tpl === templates[0] ? true : undefined}>
              <span className={s.templateIcon} aria-hidden="true">
                <Icon name="wand" size={15} />
              </span>
              <span className={s.templateText}>
                <span className={s.templateName}>
                  {tpl.name}
                  {tpl.plan ? <span className={s.badge}>{t('dialogs.templates.plansFirst')}</span> : null}
                  {tpl.builtIn ? null : <span className={`${s.badge} ${s.badgeMuted}`}>{t('dialogs.templates.yours')}</span>}
                </span>
                <span className={s.templatePrompt}>{withBlanks(tpl.prompt)}</span>
              </span>
            </button>
            {manage && !tpl.builtIn ? (
              <button type="button" className={s.remove} aria-label={t('dialogs.templates.removeName', { name: tpl.name })} title={t('dialogs.templates.remove')} onClick={() => setRemoving(tpl)}>
                <Icon name="x" size={11} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </FormSheet>
  );
}

/** Save a new template: its name, what Claude should do, and whether it plans first. */
export function TemplateEditorSheet({ close }: { close: () => void }) {
  const t = useT();
  const api = useApi();
  const names = useApp((st) => st.templates);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [plan, setPlan] = useState(false);
  const taken = names.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
  const builtIn = taken?.builtIn === true;
  return (
    <FormSheet
      title={t('dialogs.templates.newTitle')}
      icon="wand"
      intro={t('dialogs.templates.newIntro')}
      submitLabel={taken && !builtIn ? t('dialogs.templates.replace') : t('dialogs.templates.save')}
      canSubmit={Boolean(name.trim() && prompt.trim()) && !builtIn}
      onSubmit={() => {
        // The core reads "name: prompt"; a colon in the name would end it early.
        void api.workbench.saveTemplate(`${name.trim().replace(/:/g, ' ')}: ${prompt.trim()}`, plan);
        close();
      }}
      onCancel={close}
      width={560}
    >
      <Field label={t('dialogs.templates.name')} htmlFor="tpl-name" error={builtIn ? t('dialogs.templates.builtInName') : undefined} hint={taken ? t('dialogs.templates.taken') : undefined}>
        <TextInput id="tpl-name" value={name} onChange={setName} placeholder={t('dialogs.templates.namePlaceholder')} maxLength={60} invalid={builtIn} />
      </Field>
      <Field label={t('dialogs.templates.prompt')} htmlFor="tpl-prompt" hint={t('dialogs.templates.promptHint')}>
        <TextArea id="tpl-prompt" value={prompt} onChange={setPrompt} rows={5} placeholder={t('dialogs.templates.promptPlaceholder')} />
      </Field>
      <Field label="">
        <Checkbox checked={plan} onChange={setPlan} label={t('dialogs.templates.planFirst')} detail={t('dialogs.templates.planFirstDetail')} />
      </Field>
    </FormSheet>
  );
}
