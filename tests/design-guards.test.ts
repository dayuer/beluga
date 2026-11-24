import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { errorText, errorWords } from '../src/shared/error-text.js';

/**
 * The rules of docs/design.md a test can check, in the Mac app's sources. Each list is what's
 * there today: shrink it when you fix one (the test then asks you to), never grow it. A place that
 * truly needs its own colour says why in a comment beside it, and is added here with that reason.
 */
const root = path.join(import.meta.dirname, '../packages/mac/src');
const files = (readdirSync(root, { recursive: true }) as string[]).map((f) => f.split(path.sep).join('/')).sort();
const read = (f: string): string => readFileSync(path.join(root, f), 'utf8');
const sources = files.filter((f) => /\.tsx?$/.test(f));

/** Black or white (an overlay shade, as tokens.css's hover and hairlines): right on every theme. */
const neutral = (c: string): boolean => {
  const v = c.toLowerCase().replace(/\s/g, '');
  if (/^#(f{3}|f{6}|0{3}|0{6}|f{8}|0{8})$/.test(v)) return true;
  const m = /^rgba?\((\d+),(\d+),(\d+)/.exec(v);
  return !!m && m[1] === m[2] && m[2] === m[3] && (m[1] === '0' || m[1] === '255');
};

describe('docs/design.md, checked', () => {
  it('styles take colours from tokens: the places that still write their own are known', () => {
    const own: Record<string, number> = {};
    for (const f of files.filter((x) => x.endsWith('.css') && x !== 'styles/tokens.css')) {
      const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
      let n = 0;
      // A property's value (a custom property, `--x: #…`, is a local palette, the place a colour belongs).
      for (const m of css.matchAll(/(^|[;{\s])([a-z-]+)\s*:([^;{}]*)/g)) {
        if (m[2]!.startsWith('--')) continue;
        const colours = m[3]!.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) ?? [];
        if (colours.some((c) => !neutral(c))) n += 1;
      }
      if (n) own[f] = n;
    }
    // The decorative scenes (onboarding, the Star sheet, fire, the showcase, glass) keep their
    // colours on purpose; the rest move to tokens as their screens are touched.
    expect(own).toEqual({
      'agent-term/agent-term.module.css': 8,
      'call/call.module.css': 12,
      'call/chatpops.module.css': 4,
      'call/notes.module.css': 1,
      'call/pointer.module.css': 1,
      'chat/btw.module.css': 1,
      'chat/chat.module.css': 1,
      'chat/composer.module.css': 1,
      'chat/images.module.css': 1,
      'chat/max.module.css': 6,
      'chat/mcp-app/mcp-app.module.css': 2,
      'components/ProjectIcon.module.css': 5,
      'components/blocks/blocks.module.css': 4,
      'components/graph/graph.module.css': 1,
      'components/preview/preview.module.css': 4,
      'components/reactbits/GlassSurface.css': 11,
      'components/views/views.module.css': 22,
      'dialogs/fire-settings.module.css': 2,
      'dialogs/menubar-settings.module.css': 6,
      'dialogs/settings.module.css': 1,
      'dialogs/star-scene.module.css': 21,
      'dialogs/support.module.css': 11,
      'layout/Sidebar.module.css': 4,
      'layout/chat-drag.module.css': 1,
      'layout/people-here.module.css': 5,
      'layout/project-groups.module.css': 1,
      'machines/machines.module.css': 1,
      'network/network.module.css': 6,
      'onboarding/onboarding.module.css': 7,
      'onboarding/scenes/scenes.module.css': 5,
      'phone/phone.module.css': 1,
      'sentinel/showcase.module.css': 6,
      'styles/base.css': 3,
      'tasks/NewTaskSheet.module.css': 6,
      'tasks/tasks.module.css': 11,
    });
  });

  it('code writes a colour only where it belongs: brands, images to share, scenes, palettes', () => {
    const coloured = sources.filter((f) => (read(f).match(/["'`]#[0-9a-fA-F]{3,8}["'`]/g) ?? []).some((q) => !neutral(q.slice(1, -1))));
    expect(coloured).toEqual([
      'agent-term/TermPane.tsx',
      'call/demo-media.ts',
      'call/leak-probe.ts',
      'chat/Dictation.tsx',
      'chat/fire-look.ts',
      'chat/max-fire.ts',
      'components/pixel-burst-model.ts',
      'components/reactbits/GlassSurface.tsx',
      'components/reactbits/Lanyard.tsx',
      'components/ui.tsx',
      'components/views/Colors.tsx',
      'dialogs/MenuBarSettings.tsx',
      'dialogs/trace-logos.ts',
      'issues/issues-model.ts',
      'lib/prefs.ts',
      'lib/terminal-themes.ts',
      'lib/themes.ts',
      'machines/brands.ts',
      'menubar/spout.ts',
      'network/QrCode.tsx',
      'onboarding/AccessSteps.tsx',
      'onboarding/Mark.tsx',
      'onboarding/Wormhole.tsx',
      'sentinel/tint.ts',
      'showcase/TablesTour.tsx',
      'views/history/graph.ts',
      'views/history/history-model.ts',
      'views/usage/YourCard.tsx',
      'views/usage/card-face.ts',
      'views/usage/titles.ts',
    ]);
  });

  it('an error reads through one errorText (src/shared/error-text.ts), never a copy of it', () => {
    const copies = sources.filter((f) => /^(export )?(const|function) errorText\b/m.test(read(f)));
    // use-net's is the network's own `message` under this name, not a copy.
    expect(copies).toEqual(['network/use-net.ts']);
    expect(errorText(new Error('No such branch'))).toBe('No such branch');
    expect(errorText('gone')).toBe('gone');
    expect(errorWords(new Error('Error: No such branch'))).toBe('No such branch');
    expect(errorWords(new Error('Bad arguments for traces.add: url is required'))).toBe('url is required');
  });

  it('plurals stay inline, where the translation extractor sees them: no new plural helpers', () => {
    // `plural(n, 'commit')` hides "{0} commit{1}" from scripts/i18n-extract.mjs, so the catalog only
    // has what someone added by hand ("{0} commits"): "1 commit" and the sentences around a count
    // ("Delete {0} worktree{1} permanently?") stay English. These move to inline as they're touched.
    const helpers = sources.filter((f) => /^(export )?(const|function) plural\b/m.test(read(f)));
    expect(helpers).toEqual([
      'claude-code/cc-model.ts',
      'dialogs/native/MergeReview.tsx',
      'dialogs/native/WorkConfirm.tsx',
      'layout/attention-model.ts',
      'views/WorktreeInfo.tsx',
      'views/history/history-model.ts',
      'views/overview/overview-selection.ts',
      'views/project/EarningsSection.tsx',
      'views/project/EnvSection.tsx',
      'views/project/GitHubRow.tsx',
      'views/project/MainSyncBar.tsx',
      'views/project/home-model.ts',
      'views/usage/Breakdown.tsx',
      'views/usage/StorageCard.tsx',
      'views/usage/stats-model.ts',
      'views/worktrees/BatchAlerts.tsx',
      'views/worktrees/WorktreeItem.tsx',
      'views/worktrees/worktrees-model.ts',
    ]);
  });
});
