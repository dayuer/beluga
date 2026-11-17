import type { ReactElement } from 'react';
import type { NativeSheet } from '../lib/sheets.js';
import { PlanSettingsSheet } from '../plans/PlanSettingsSheet.js';
import { NewPlanSheet } from './plans/NewPlanSheet.js';

/**
 * Fork: the sheets the fork draws itself, asked first by NativeSheets (dialogs/native/WorkSheets.tsx,
 * one line there). New Plan with a pop-up per role, and Plan Settings. Undefined: upstream's switch draws it.
 */
export function forkSheet(sheet: NativeSheet, close: () => void): ReactElement | undefined {
  switch (sheet.kind) {
    case 'new_plan':
      return <NewPlanSheet {...(sheet.projectId ? { projectId: sheet.projectId } : {})} close={close} />;
    case 'plan_settings':
      return <PlanSettingsSheet key={sheet.planId} planId={sheet.planId} close={close} />;
    default:
      return undefined;
  }
}
