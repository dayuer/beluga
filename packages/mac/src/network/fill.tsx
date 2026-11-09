import type { ReactNode } from 'react';

/** Words with a `{name}` left in them (`t(key)` without it), the name drawn as `node` (a bold span…). */
export function fill(text: string, node: ReactNode): ReactNode {
  const at = text.indexOf('{name}');
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      {node}
      {text.slice(at + '{name}'.length)}
    </>
  );
}
