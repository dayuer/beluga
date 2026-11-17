import { describe, expect, it } from 'vitest';
import { buildScratchAppend } from '../src/agent/prompt.js';

describe('the scratch folder, as the agent is told', () => {
  it('its full path too, with how a picture from it is written, so no model writes `/.beluga/scratch/…`', () => {
    const said = buildScratchAppend('.beluga/scratch', '/Users/kay/.beluga/workspaces/app/fix-login/');
    expect(said).toContain('Scratch folder: .beluga/scratch/ in your working folder');
    expect(said).toContain('Its full path is /Users/kay/.beluga/workspaces/app/fix-login/.beluga/scratch/.');
    expect(said).toContain('![Login page](/Users/kay/.beluga/workspaces/app/fix-login/.beluga/scratch/01-login.png)');
  });

  it('without the run’s folder, only the relative one, as before', () => {
    expect(buildScratchAppend('.beluga/scratch')).not.toContain('full path');
  });
});
