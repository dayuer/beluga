import { MilestoneMap, PlanUiThemeProvider, type MapItem } from '../../../ui-plan';
import { planUiTheme } from './planUiTheme';

/** The plan map on the customer's plan page (the shared MilestoneMap with the customer's tokens). */
export function PlanMap({ items, onPick, scale }: { readonly items: readonly MapItem[]; readonly onPick: (id: string) => void; readonly scale?: number }) {
  return (
    <PlanUiThemeProvider theme={planUiTheme()}>
      <MilestoneMap items={items} onPick={onPick} scale={scale} nodeWidth={236} testID="plan-map" />
    </PlanUiThemeProvider>
  );
}
