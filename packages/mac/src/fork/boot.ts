// Fork: what the fork starts with the page, one import in main.tsx (docs/fork.md, min-conflict).
import { installImeGuard } from './ime-guard.js';
// The shared controls drawn as macOS draws them (fork/native/).
import './native/index.js';

installImeGuard();
