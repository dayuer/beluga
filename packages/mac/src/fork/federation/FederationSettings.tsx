import { useEffect, useState } from 'react';
import { ATONCE_MAX, ATONCE_MIN, type Federation, clampAtOnce, federationOf } from '@beluga/fork/federation/settings.js';
import { useApi, useApp } from '../../lib/beluga.js';
import { Group, Row, Select } from '../../dialogs/settings-controls.js';
import s from '../../dialogs/settings.module.css';

/**
 * Settings › Agent › Auto Accept (fork, src/fork/federation/settings.ts): a task a teammate gives
 * this computer starts on its own, with Claude, when you trust them enough, a few at a time.
 * This computer's own: it never syncs to your other computers, and the phone doesn't offer it.
 * Drawn under Auto Route (dialogs/AutoRouteSettings.tsx), so Settings.tsx stays as upstream has it.
 */
export function FederationSettings() {
  const api = useApi();
  const raw = useApp((st) => st.prefs.federation);
  const cur = federationOf(raw);
  const save = (patch: Federation): void => void api.session.setPrefs({ federation: { ...raw, ...patch } });
  const [count, setCount] = useState(String(cur.atOnce));
  useEffect(() => setCount(String(cur.atOnce)), [cur.atOnce]);
  const saveCount = (): void => {
    const n = clampAtOnce(Number(count));
    setCount(String(n));
    if (n !== cur.atOnce) save({ atOnce: n });
  };
  return (
    <Group title={'Auto Accept'}>
      <Row label={'Start tasks teammates give me'} detail={'A Ready task a teammate gives you starts here by itself, with Claude in its own worktree. Never one you gave yourself.'}>
        <Select
          label={'Start tasks teammates give me'}
          value={cur.accept}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'assigned', label: 'Tasks given to me' },
          ]}
          // 'pool' comes in milestone 2: until then it shows as the placeholder.
          placeholder={'Tasks given to me, and the pool'}
          onChange={(v) => save({ accept: v as 'off' | 'assigned' })}
        />
      </Row>
      {cur.accept !== 'off' ? (
        <Row label={'Only from'} detail={'Tasks from anyone else wait for you to start them.'}>
          <Select
            label={'Only from'}
            value={cur.from}
            options={[
              { value: 'full', label: 'People you fully trust' },
              { value: 'trusted', label: 'People you trust' },
            ]}
            onChange={(v) => save({ from: v as 'full' | 'trusted' })}
          />
        </Row>
      ) : null}
      {cur.accept !== 'off' ? (
        <Row label={'Running at once'} detail={`How many tasks it starts by itself can run at the same time (${ATONCE_MIN}–${ATONCE_MAX}). The rest wait their turn.`}>
          <form
            className={s.daysField}
            onSubmit={(e) => {
              e.preventDefault();
              saveCount();
            }}
          >
            <input aria-label={'Tasks at once'} className={s.days} type="number" inputMode="numeric" min={ATONCE_MIN} max={ATONCE_MAX} step={1} value={count} onChange={(e) => setCount(e.target.value)} onBlur={saveCount} />
          </form>
        </Row>
      ) : null}
    </Group>
  );
}
