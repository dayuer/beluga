import './native-controls.css';

/**
 * Native controls (fork; docs/fork.md, "原生控件"): the shared controls — FormSheet's fields and
 * buttons, alerts, the pop-up button, checkboxes and the segmented control — drawn the way AppKit
 * draws them, instead of as web inputs. Every rule lives in native-controls.css and hangs on
 * upstream's CSS-module classes (`[class*='_name_']`, checked by tests/fork-native-anchors.test.ts)
 * under `:root[data-native]`, which this module sets before the first frame. Upstream files have
 * no lines for it: fork/boot.ts imports this.
 */
export const NATIVE_ATTR = 'native';

if (typeof document !== 'undefined') document.documentElement.dataset[NATIVE_ATTR] = '';
