import type { ReactTestRendererJSON } from 'react-test-renderer';

export type JsonNode = ReactTestRendererJSON | string | null;

export function findAllJson(
  node: JsonNode | JsonNode[],
  pred: (el: ReactTestRendererJSON) => boolean,
): ReactTestRendererJSON[] {
  const out: ReactTestRendererJSON[] = [];
  const visit = (cur: JsonNode | JsonNode[]): void => {
    if (!cur || typeof cur === 'string') return;
    if (Array.isArray(cur)) {
      for (const item of cur) visit(item);
      return;
    }
    if (pred(cur)) out.push(cur);
    if (cur.children) {
      for (const child of cur.children) visit(child as JsonNode);
    }
  };
  visit(node);
  return out;
}
