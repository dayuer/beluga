import { useState } from 'react';
import { MAX_PROJECT_CONTEXT } from '@beluga/core/board/model.js';
import { Field, FormSheet, TextArea } from '../components/FormSheet.js';
import { toast, useApp, useBeluga } from '../lib/beluga.js';
import { sameDeep } from '../lib/stable.js';
import { ago } from './tasks-model.js';
import { useBoard, useTaskActions } from './use-tasks.js';
import { useT } from '../i18n/index.js';


/**
 * About This Project (BLG-298): a few paragraphs Claude reads whenever it writes a task here, so a
 * task makes sense without a look at the whole codebase. Teammates on the project share it.
 */
export function ProjectContextSheet({ projectId, close }: { projectId: string; close: () => void }) {
  const board = useBoard();
  const { client } = useBeluga();
  const { api } = useTaskActions();
  const mates = useApp((st) => st.team.teams[projectId]?.mates.map((m) => m.name) ?? [], sameDeep);
  const saved = board.projects[projectId]?.context;
  const [text, setText] = useState(saved?.text ?? '');
  const changed = text.trim() !== (saved?.text ?? '');
  const t = useT();
  const shared = mates.length ? t('tasks.context.sharedWith', { names: mates.join(', ') }) : t('tasks.context.teammates');
  return (
    <FormSheet
      title={t('tasks.context.title')}
      icon="book"
      intro={t('tasks.context.intro')}
      submitLabel={t('plans.sheets.save')}
      width={600}
      canSubmit={changed}
      onCancel={close}
      onSubmit={async () => {
        await api.setContext(projectId, text);
        close();
        toast(client, text.trim() ? t('tasks.context.toast.saved') : t('tasks.context.toast.cleared'), 'success');
      }}
    >
      <Field label={t('plans.details.context')} htmlFor="project-context" hint={`${shared}${saved?.text ? t('tasks.context.lastEdited', { by: saved.by, when: ago(saved.at) }) : ''}`}>
        <TextArea id="project-context" autoFocus rows={12} value={text} placeholder={t('tasks.context.placeholder')} maxLength={MAX_PROJECT_CONTEXT} onChange={setText} />
      </Field>
    </FormSheet>
  );
}
