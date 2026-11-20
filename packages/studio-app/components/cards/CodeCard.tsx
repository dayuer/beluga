import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  readonly onRetryPush?: (cardId: string) => Promise<boolean | void> | boolean | void;
  readonly testID?: string;
}

const STATE_KEY: Record<CodeCardData['pushState'], 'codeCard.state.ready' | 'codeCard.state.pushed' | 'codeCard.state.failed'> = {
  ready: 'codeCard.state.ready',
  pushed: 'codeCard.state.pushed',
  failed: 'codeCard.state.failed',
};

/**
 * 代码卡（SS-46 / SS-191）：只读展示仓库、PR 与推送状态；
 * - 跟随 card.pushState 同步；
 * - 仅在传入 onRetryPush 且失败时显示「重新推送」，失败时展示原因；
 * - 仓库和 PR 链接点击通过 Linking.openURL 打开（不显示分支名）。
 */
export function CodeCard({ card, lang: langProp, onRetryPush, testID = 'code-card' }: CodeCardProps) {
  const lang = langProp ?? detectLang();
  const [pushState, setPushState] = useState<CodeCardData['pushState']>(card.pushState);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setPushState(card.pushState);
    setRetryError(null);
  }, [card.id, card.pushState]);

  const handleRetry = async () => {
    if (retrying || !onRetryPush) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await onRetryPush(card.id);
      if (res === false) {
        setRetryError(tCards(lang, 'codeCard.retryFailed'));
        setAttempt((a) => a + 1);
        return;
      }
      setPushState('pushed');
    } catch (err) {
      const msg = err instanceof Error && err.message.trim() ? err.message : tCards(lang, 'codeCard.retryFailed');
      setRetryError(msg);
      setAttempt((a) => a + 1);
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
        pushState === 'failed' && onRetryPush ? (
          <ActionRow
            primary={
              <PrimaryButton
                key={attempt}
                label={retrying ? tCards(lang, 'codeCard.retrying') : tCards(lang, 'codeCard.retryPush')}
                state={retrying ? 'working' : 'idle'}
                error={retryError}
                onPress={() => void handleRetry()}
                testID={`${testID}-retry`}
              />
            }
          />
        ) : undefined
      }
      testID={testID}
    >
      <Pressable
        onPress={() => void Linking.openURL(card.repoUrl)}
        accessibilityRole="link"
        accessibilityLabel={card.repoUrl}
        testID={`${testID}-repo-link`}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <Text style={[styles.label, { color: color.text3 }]}>{tCards(lang, 'codeCard.repo')}</Text>
        <Text style={[styles.value, { color: color.info }]} numberOfLines={1}>
          {card.repoUrl}
        </Text>
      </Pressable>
      {card.prUrl ? (
        <Pressable
          onPress={() => void Linking.openURL(card.prUrl!)}
          accessibilityRole="link"
          accessibilityLabel={card.prUrl}
          testID={`${testID}-pr-link`}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <Text style={[styles.label, { color: color.text3 }]}>{tCards(lang, 'codeCard.pr')}</Text>
          <Text style={[styles.value, { color: color.info }]} numberOfLines={1}>
            {card.prUrl}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 44 },
  pressed: { opacity: 0.7 },
  label: { ...type.caption, minWidth: 56 },
  value: { ...type.callout, flex: 1 },
});
