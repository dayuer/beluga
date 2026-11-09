import { useCurrencyChoice } from '../lib/earnings.js';
import { Group, Row, Select } from './settings-controls.js';
import { useT } from '../i18n/index.js';

/** "Show earnings in": the one currency every earnings total is added up in. */
export function CurrencySelect({ id, size, className }: { id?: string; size?: 'regular' | 'small'; className?: string }) {
  const choice = useCurrencyChoice();
  const t = useT();
  return <Select id={id} className={className} label={t('settings.earnings.showIn')} value={choice.value} options={choice.options} onChange={choice.onChange} size={size} searchPlaceholder={t('settings.earnings.searchCurrencies')} />;
}

/** Settings › General › Earnings. */
export function EarningsSettings() {
  const t = useT();
  return (
    <Group title={t('settings.earnings.title')}>
      <Row label={t('settings.earnings.showIn')} detail={t('settings.earnings.detail')}>
        <CurrencySelect />
      </Row>
    </Group>
  );
}
