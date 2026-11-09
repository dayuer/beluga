import { useEffect, useMemo, useState } from 'react';
import type { Recipe, SentinelDraft } from '@beluga/core/sentinel/model.js';
import { Field, FormSheet, Popup, TextArea, TextInput } from '../components/FormSheet.js';
import { Segmented } from '../components/ui.js';
import { useApp } from '../lib/beluga.js';
import { projectOfView } from '../tasks/use-tasks.js';
import { Icon } from '../components/Icon.js';
import { MAC_SCOPE, describedName, iconOf, recipeWhen } from './sentinel-model.js';
import { useSentinelActions } from './use-sentinel.js';
import s from './sentinel.module.css';
import { ASSISTANT_TITLE, THIS_COMPUTER } from '@beluga/shared/assistant.js';
import { useT } from '../i18n/index.js';

type Way = 'describe' | 'recipe' | 'build';

const ways = (tr: ReturnType<typeof useT>): ReadonlyArray<{ readonly value: Way; readonly label: string; readonly icon: 'claude' | 'wand' | 'wrench'; readonly hint: string }> => [
  { value: 'describe', label: tr('sentinel.new.describe'), icon: 'claude', hint: tr('sentinel.new.describeHint') },
  { value: 'recipe', label: tr('sentinel.new.recipe'), icon: 'wand', hint: tr('sentinel.new.recipeHint') },
  { value: 'build', label: tr('sentinel.new.build'), icon: 'wrench', hint: tr('sentinel.new.buildHint') },
];

/**
 * New Sentinel: three ways in, as the project home's composer offers them. Describe it makes an
 * empty, paused sentinel and asks your Claude to fill it in (the page opens and shows it working);
 * a recipe makes one filled in (paused) and opens its page; Build it yourself makes an empty one
 * that runs when you press Run. Every new sentinel starts paused.
 */
export function NewSentinelSheet({ projectId, way: first = 'describe', close }: { projectId?: string; way?: Way; close: () => void }) {
  const a = useSentinelActions();
  const tr = useT();
  const all = useApp((st) => st.projects);
  const inView = useApp(projectOfView);
  const projects = useMemo(() => all.filter((p) => p.root && !p.error), [all]);
  // The project you're in (or the list's); anywhere else Your Mac, first in the list: a sentinel can work on the Mac itself.
  const start = projectId === MAC_SCOPE || projects.some((p) => p.id === projectId) ? projectId! : (inView ?? MAC_SCOPE);
  const [project, setProject] = useState<string>(start ?? MAC_SCOPE);
  const [way, setWay] = useState<Way>(first);
  const [name, setName] = useState('');
  const [words, setWords] = useState('');
  const [recipes, setRecipes] = useState<readonly Recipe[]>();
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    let alive = true;
    void a.act(() => a.api.recipes()).then((r) => alive && setRecipes(r ?? []));
    return () => {
      alive = false;
    };
  }, [a]);

  const where = project === MAC_SCOPE ? null : project;
  const make = async (draft: SentinelDraft): Promise<string | void> => {
    const made = await a.act(() => a.create({ ...draft, projectId: where }));
    if (!made) return tr('sentinel.new.couldntMake');
    close();
    a.open(made.id);
  };
  /** Describe it: an empty, paused sentinel, then your Claude fills it in from the words. */
  const describe = async (): Promise<string | void> => {
    const text = words.trim();
    if (!text) return;
    const made = await a.act(() => a.create({ name: describedName(text), projectId: where, trigger: { kind: 'manual' }, steps: [] }));
    if (!made) return tr('sentinel.new.couldntMake');
    close();
    a.open(made.id);
    await a.act(() => a.api.ask(made.id, text));
  };
  /** A recipe: its sentinel filled in (paused), and the one that runs after it when it has one. */
  const pick = async (r: Recipe): Promise<void> => {
    if (busy) return;
    setBusy(r.id);
    const made = await a.act(() => a.create({ ...r.sentinel, projectId: where }));
    if (made && r.then) await a.act(() => a.create({ ...r.then!.sentinel, projectId: where, trigger: { kind: 'after', sentinelId: made.id, on: r.then!.on } }));
    setBusy(undefined);
    if (!made) return;
    close();
    a.open(made.id);
  };

  const projectName = project === MAC_SCOPE ? ASSISTANT_TITLE : projects.find((p) => p.id === project)?.name;
  return (
    <FormSheet
      title={tr('sentinel.new.title')}
      icon="sentinel"
      intro={tr('sentinel.new.intro')}
      submitLabel={way === 'build' ? tr('sentinel.new.make') : way === 'describe' ? tr('sentinel.new.writeIt') : tr('sentinel.new.pickRecipe')}
      canSubmit={(way === 'build' && Boolean(name.trim())) || (way === 'describe' && Boolean(words.trim()))}
      width={640}
      onCancel={close}
      onSubmit={() => (way === 'build' ? make({ name: name.trim(), trigger: { kind: 'manual' }, steps: [] }) : way === 'describe' ? describe() : undefined)}
    >
      <div className={s.sheetBody}>
        <div className={s.ways}>
          <Segmented<Way> label={tr('sentinel.new.howToMake')} value={way} onChange={setWay} options={ways(tr)} />
        </div>
        <div className={s.row2}>
          <span className={s.label}>{tr('sentinel.cards.where')}</span>
          <Popup
            label={tr('sentinel.new.whereItWorks')}
            value={project}
            onChange={setProject}
            options={[{ value: MAC_SCOPE, label: ASSISTANT_TITLE, description: tr('sentinel.new.macDetail', { computer: THIS_COMPUTER }) }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </div>
        {way === 'describe' ? (
          <Field label={tr('sentinel.new.whatShouldItDo')} htmlFor="sentinel-words" hint={tr('sentinel.new.describeFieldHint', { where: projectName ?? ASSISTANT_TITLE })}>
            <TextArea
              id="sentinel-words"
              value={words}
              onChange={setWords}
              rows={4}
              maxLength={8000}
              placeholder={tr('sentinel.new.wordsPlaceholder')}
              data-autofocus
              aria-label={tr('sentinel.new.whatShouldItDo')}
            />
          </Field>
        ) : way === 'recipe' ? (
          !recipes ? (
            <div className={s.empty}>{tr('sentinel.new.readingRecipes')}</div>
          ) : (
            <div className={s.recipeLists}>
              {(
                [
                  ['recipes', recipes.filter((r) => r.group !== 'numbers')],
                  ['numbers', recipes.filter((r) => r.group === 'numbers')],
                ] as const
              ).map(([label, list]) =>
                list.length ? (
                  <div key={label}>
                    {label !== 'recipes' ? <div className={s.recipeGroup}>{tr('sentinel.new.numbersGroup')}</div> : null}
                    <div className={s.recipes} role="list" aria-label={label === 'recipes' ? tr('sentinel.new.recipes') : tr('sentinel.model.newStep.measure')}>
                      {list.map((r) => (
                        <button key={r.id} type="button" role="listitem" className={s.recipe} aria-busy={busy === r.id} disabled={Boolean(busy)} onClick={() => void pick(r)} data-recipe={r.id}>
                          <Icon name={iconOf(r.icon)} size={14} />
                          <span className={s.recipeName}>{r.name}</span>
                          <span className={s.recipeWhen} title={recipeWhen(r)}>
                            {recipeWhen(r)}
                          </span>
                          <span className={s.recipeLine}>{r.line}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          )
        ) : (
          <Field label={tr('sentinel.new.name')} htmlFor="sentinel-name" hint={tr('sentinel.new.nameHint', { where: projectName ?? ASSISTANT_TITLE })}>
            <TextInput id="sentinel-name" value={name} onChange={setName} maxLength={80} placeholder={tr('sentinel.new.namePlaceholder')} data-autofocus />
          </Field>
        )}
      </div>
    </FormSheet>
  );
}
