/**
 * The fork's own settings fields, spread into upstream's Settings (shared/settings-schema.ts) and
 * PrefsPatch (ipc/api.ts) in one line each, so adding one never touches those files again.
 * Browser-safe: settings-schema.ts is loaded by the screens.
 */
import { AutoRoute } from '../shared/auto-route.js';

export const forkSettingFields = {
  /** Who works a task nobody picked an agent for (shared/auto-route.ts); unset: its defaults, on once a local candidate runs here. */
  autoRoute: AutoRoute.optional(),
};

/** The same fields as a settings change (null: back to the default). */
export const forkPrefsPatch = {
  autoRoute: AutoRoute.nullable().optional(),
};
