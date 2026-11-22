import { StyleSheet, Text } from 'react-native';
import type { z } from 'zod';
import { detectLang, type Lang } from '../../lib/strings';
import { tWait } from '../../lib/strings/wait';
import { color, type } from '../../lib/theme';
import type { WaitCardSchema, WaitReason } from '../../lib/views';
import { Card } from '../card/Card';
import { InlineHint } from '../InlineHint';

export type WaitCardData = z.infer<typeof WaitCardSchema>;

export interface WaitCardProps {
  readonly card: WaitCardData;
  readonly lang?: Lang;
  readonly testID?: string;
}

const REASON_KEY: Record<
  WaitReason,
  'wait.reason.offline' | 'wait.reason.queued' | 'wait.reason.quota' | 'wait.reason.needs-human'
> = {
  offline: 'wait.reason.offline',
  queued: 'wait.reason.queued',
  quota: 'wait.reason.quota',
  'needs-human': 'wait.reason.needs-human',
};

const ETA_KEY: Record<
  WaitReason,
  'wait.eta.offline' | 'wait.eta.queued' | 'wait.eta.quota' | 'wait.eta.needs-human'
> = {
  offline: 'wait.eta.offline',
  queued: 'wait.eta.queued',
  quota: 'wait.eta.quota',
  'needs-human': 'wait.eta.needs-human',
};

/**
 * P4 等待卡（SS-45）：原因（执行机器离线、排队第几、用量已满、需要人）、何时会好、「你不用做什么」；
 * 灰色，不用红；使用 InlineHint。
 */
export function WaitCard({ card, lang: langProp, testID = 'wait-card' }: WaitCardProps) {
  const lang = langProp ?? detectLang();
  const reasonText = card.message?.trim() ? card.message : tWait(lang, REASON_KEY[card.reason]);
  const whenReady = card.etaText?.trim() ? card.etaText : tWait(lang, ETA_KEY[card.reason]);
  const noAction = card.customerAction?.trim() ? card.customerAction : tWait(lang, 'wait.noAction');

  return (
    <Card title={tWait(lang, 'wait.title')} status="waiting" testID={testID}>
      <InlineHint
        tone="waiting"
        waitReason={card.reason}
        reason={reasonText}
        whenReady={whenReady}
        testID={`${testID}-hint`}
      />
      <Text style={[styles.noAction, { color: color.text3 }]} testID={`${testID}-no-action`}>
        {noAction}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  noAction: {
    ...type.caption,
  },
});
