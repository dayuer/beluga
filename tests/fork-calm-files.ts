import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Every .css under packages/mac/src, with its path relative to src (`/`-separated, as the calm build plugin names them). */
export function macCss(dir = path.join('packages', 'mac', 'src'), rel = ''): { rel: string; css: string }[] {
  return readdirSync(dir).flatMap((f) => {
    const abs = path.join(dir, f);
    const r = rel ? `${rel}/${f}` : f;
    if (statSync(abs).isDirectory()) return macCss(abs, r);
    return f.endsWith('.css') ? [{ rel: r, css: readFileSync(abs, 'utf8') }] : [];
  });
}
