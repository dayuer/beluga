import { Outline, PlanUiThemeProvider, type OutlineMilestone } from '../../../ui-plan';
import { planUiTheme } from './planUiTheme';

/** The plan outline on the customer's plan page (the shared Outline with the customer's tokens). */
export function PlanOutline({ milestones, open, onToggle }: { readonly milestones: readonly OutlineMilestone[]; readonly open: readonly string[]; readonly onToggle: (id: string) => void }) {
  return (
    <PlanUiThemeProvider theme={planUiTheme()}>
      <Outline milestones={milestones} open={open} onToggle={onToggle} testID="plan-outline" />
    </PlanUiThemeProvider>
  );
}
