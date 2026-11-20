import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scanSourceForBrowserGlobals } from './check-native.mjs';

describe('check-native', () => {
  it('ignores module names and string literals containing document/window/navigator/localStorage', () => {
    const source = [
      "import * as DocumentPicker from 'expo-document-picker';",
      'const pkg = "expo-document-picker";',
      'const tpl = `using window and document in text`;',
      '// window.addEventListener in line comment',
      '/* document.title in block comment */',
      "const obj = { dir: Paths.document, url: 'https://example.com/window' };",
      'obj.window = 1;',
    ].join('\n');

    assert.deepEqual(scanSourceForBrowserGlobals(source), []);
  });

  it('catches real browser global accesses like document.title and window.addEventListener', () => {
    const source = [
      "import * as DocumentPicker from 'expo-document-picker';",
      'const t = document.title;',
      'window.addEventListener("resize", () => {});',
      'const x = window.x;',
      'const v = localStorage.getItem("k");',
      'const u = navigator.userAgent;',
      'const inTpl = `${window.location.href}`;',
    ].join('\n');

    const hits = scanSourceForBrowserGlobals(source);
    assert.deepEqual(
      hits.map((h) => [h.line, h.globalName]),
      [
        [2, 'document'],
        [3, 'window'],
        [4, 'window'],
        [5, 'localStorage'],
        [6, 'navigator'],
        [7, 'window'],
      ],
    );
  });
});
