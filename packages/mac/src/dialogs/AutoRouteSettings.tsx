import { agentChoices } from '@beluga/ui/agent-choice.js';
import { type AutoRoute, type AutoTier, HARD_LABEL, MAX_CANDIDATES, autoRouteOn, candidateRuns, tierList } from '@beluga/shared/auto-route.js';
import { agentEntries } from '../chat/ModelPicker.js';
import { Button } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { Group, Row, Select, Switch } from './settings-controls.js';

/**
 * Settings › Agent › Auto Route (fork, shared/auto-route.ts): a task nobody picked an agent for
 * goes, when it starts, to the first model of its list that runs here: hard work (the `hard`
 * label, urgent or high) to the strong list, the rest to the cheap one. Unset, it's on once one of its local candidates runs here.
 */
export function AutoRouteSettings() {
  const api = useApi();
  const route = useApp((s) => s.prefs.autoRoute);
  const runtimes = useApp((s) => s.runtimes);
  const models = useApp((s) => s.models);
  const on = autoRouteOn(route, runtimes);
  const entries = agentEntries(agentChoices(runtimes, models));
  const save = (patch: Partial<AutoRoute>): void => {
    const next: AutoRoute = { ...route, ...patch };
    void api.session.setPrefs({ autoRoute: next });
  };
  const setList = (tier: AutoTier, list: readonly string[]): void => save({ [tier]: [...list] });

  const tierRows = (tier: AutoTier) => {
    const list = tierList(tier, route);
    const used = list.find((v) => candidateRuns(runtimes, v));
    const custom = route?.[tier];
    return (
      <Group title={(tier === 'hard' ? 'Hard Work' : 'Everything Else')}>
        {list.map((value, i) => {
          const runs = candidateRuns(runtimes, value);
          const detail = value === used ? 'Used now' : runs ? 'If the one above stops working' : 'Not set up on this Mac: skipped';
          return (
            <Row key={`${tier}-${i}`} label={`Choice ${(i + 1)}`} detail={detail}>
              <Select label={`Choice ${(i + 1)}`} value={value} options={entries} placeholder={value} onChange={(v) => setList(tier, list.map((x, j) => (j === i ? v : x)))} />
              <Button size="small" disabled={i === 0} aria-label={'Move up'} onClick={() => setList(tier, list.map((x, j) => (j === i - 1 ? value : j === i ? list[i - 1]! : x)))}>
                ↑
              </Button>
              <Button size="small" disabled={list.length <= 1} aria-label={'Remove'} onClick={() => setList(tier, list.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </Row>
          );
        })}
        <Row label={used ? 'Its tasks start on the one marked Used now' : 'None of these runs here: your default agent works these tasks'} detail={custom ? 'Your own list.' : 'The default list.'}>
          {list.length < MAX_CANDIDATES ? (
            <Button size="small" onClick={() => setList(tier, [...list, 'claude:'])}>
              {'Add'}
            </Button>
          ) : null}
          {custom ? (
            <Button size="small" onClick={() => save({ [tier]: undefined })}>
              {'Back to Default'}
            </Button>
          ) : null}
        </Row>
      </Group>
    );
  };

  return (
    <>
      <Group title={'Auto Route'}>
        <Row label={'Pick a model for each task'} detail={'A task nobody picked an agent for goes, when it starts, to the first model of its list that runs here. A task’s own agent, its plan’s or its project’s always wins.'}>
          <Switch label={'Pick a model for each task'} on={on} onChange={(v) => save({ on: v })} />
        </Row>
        {on ? (
          <Row label={'Urgent and high are hard too'} detail={`A task labeled “${(route?.hardLabel ?? HARD_LABEL)}” is always hard. Add that label to the project’s labels so tasks can have it.`}>
            <Switch label={'Urgent and high are hard too'} on={route?.urgentIsHard !== false} onChange={(v) => save({ urgentIsHard: v })} />
          </Row>
        ) : null}
      </Group>
      {on ? tierRows('hard') : null}
      {on ? tierRows('build') : null}
    </>
  );
}
