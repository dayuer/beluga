import { Row, Switch } from '../../dialogs/settings-controls.js';
import { setCalm, useCalm } from './index.js';

/**
 * Settings › Appearance › Layout: the calm-mode switch (docs/calm-ui.md). This is this fork's own
 * row; Settings.tsx has one line that draws it, registered in docs/fork.md.
 */
export function CalmRow() {
  const calm = useCalm();
  return (
    <Row label="Calm mode" detail="A still, predictable window: short motion, and nothing that moves on its own.">
      <Switch label="Calm mode" on={calm} onChange={setCalm} />
    </Row>
  );
}
