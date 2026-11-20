import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { z } from 'zod';
import { detectLang, type Lang } from '../../lib/strings';
import { tCards } from '../../lib/strings/cards';
import { color, space, type } from '../../lib/theme';
import type { CodeCardSchema } from '../../lib/views';
import { ActionRow } from '../card/ActionRow';
import { Card } from '../card/Card';
import { PrimaryButton } from '../PrimaryButton';

export type CodeCardData = z.infer<typeof CodeCardSchema>;

export interface CodeCardProps {
  readonly card: CodeCardData;
  readonly lang?: Lang;
  readonly onRetryPush?: (cardId: string) => Promise<void> | void;
  readonly testID?: string;
}

const STATE_KEY: Record<CodeCardData['pushState'], 'codeCard.state.ready' | 'codeCard.state.pushed' | 'codeCard.state.failed'> = {
  ready: 'codeCard.state.ready',
  pushed: 'codeCard.state.pushed',
  failed: 'codeCard.state.failed',
};

/**
 * 代码卡（SS-46）：只读展示仓库、变更记录与推送状态；失败时提供「重新推送」。
 */
export function CodeCard({ card, lang: langProp, onRetryPush, testID = 'code-card' }: CodeCardProps) {
  const lang = langProp ?? detectLang();
  const [pushState, setPushState] = useState<CodeCardData['pushState']>(card.pushState);
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetryPush?.(card.id);
      setPushState('pushed');
    } finally {
      setRetrying(false);
    }
  };

  const cardStatus = pushState === 'failed' ? 'error' : pushState === 'pushed' ? 'done' : 'working';

  return (
    <Card
      title={tCards(lang, 'codeCard.title')}
      status={cardStatus}
      statusLabel={tCards(lang, STATE_KEY[pushState])}
      footer={
        pushState === 'failed' ? (
          <ActionRow
            primary={
              <PrimaryButton
                label={retrying ? tCards(lang, 'codeCard.retrying') : tCards(lang, 'codeCard.retryPush')}
                state={retrying ? 'working' : 'idle'}
                onPress={() => void handleRetry()}
                testID={`${testID}-retry`}
              />
            }
          />
        ) : undefined
      }
      testID={testID}
    >
      <View style={styles.row}>
        <Text style={[styles.label, { color: color.text3 }]}>{tCards(lang, 'codeCard.repo')}</Text>
        <Text style={[styles.value, { color: color.text }]} numberOfLines={1}>
          {card.repoUrl}
        </Text>
      </View>
      {card.prUrl ? (
        <View style={styles.row}>
          <Text style={[styles.label, { color: color.text3 }]}>{tCards(lang, 'codeCard.pr')}</Text>
          <Text style={[styles.value, { color: color.info }]} numberOfLines={1}>
            {card.prUrl}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  label: { ...type.caption, minWidth: 56 },
  value: { ...type.callout, flex: 1 },
});
