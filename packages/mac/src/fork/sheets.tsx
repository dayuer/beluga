import type { ReactElement } from 'react';
import type { NativeSheet } from '../lib/sheets.js';
import { PlanSettingsSheet } from '../plans/PlanSettingsSheet.js';

/**
 * Fork: the sheets the fork draws itself, asked first by NativeSheets (dialogs/native/WorkSheets.tsx,
 * one line there): Plan Settings. New Plan is upstream's, as it is. Undefined: upstream's switch draws it.
 */
export function forkSheet(sheet: NativeSheet, close: () => void): ReactElement | undefined {
  switch (sheet.kind) {
    case 'plan_settings':
      return <PlanSettingsSheet key={sheet.planId} planId={sheet.planId} close={close} />;
    default:
      return undefined;
  }
}
