import { StyleSheet, Text, View } from 'react-native';
import { detectLang, type Lang } from '../lib/strings';
import { tDrawer } from '../lib/strings/drawer';
import { color, radius, space, type } from '../lib/theme';
import type { StudioCard } from '../lib/views';
import { Card } from './card/Card';
import { CodeCard } from './cards/CodeCard';
import { DesignCard } from './cards/DesignCard';
import { UnderstandingCard } from './cards/UnderstandingCard';
import { WaitCard } from './cards/WaitCard';
import { DecisionCard, type QuestionAnswerItem } from './DecisionCard';
import { StepBar } from './StepBar';

export interface CardStreamProps {
  readonly cards: readonly StudioCard[];
  readonly lang?: Lang;
  readonly highlightedCardId?: string | null;
  readonly onCardLayout?: (cardId: string, y: number) => void;
  readonly onAnswerQuestions?: (cardId: string, answers: QuestionAnswerItem[]) => Promise<boolean | void> | boolean | void;
  readonly onConfirmUnderstanding?: (cardId: string) => Promise<void> | void;
  readonly onRejectUnderstanding?: (cardId: string, reason: string) => Promise<void> | void;
  readonly onRetryCodePush?: (cardId: string) => Promise<void> | void;
  readonly testID?: string;
}

/**
 * 卡片流（SS-52 / SS-185）：按卡片类型 switch 渲染不用签名的卡；
 * 需签名的卡（start/changes/delivery/release）与 unknown 留 default 占位，待 A9 合流补齐。
 * 支持 ?card= 高亮与定位回调。
 */
export function CardStream({
  cards,
  lang: langProp,
  highlightedCardId,
  onCardLayout,
  onAnswerQuestions,
  onConfirmUnderstanding,
  onRejectUnderstanding,
  onRetryCodePush,
  testID = 'card-stream',
}: CardStreamProps) {
  const lang = langProp ?? detectLang();

  return (
    <View style={styles.list} testID={testID}>
      {cards.map((card) => {
        const isHighlighted = Boolean(highlightedCardId && highlightedCardId === card.id);
        let node: React.ReactNode;
        switch (card.kind) {
          case 'design':
            node = <DesignCard card={card} lang={lang} testID={`card-${card.id}`} />;
            break;

          case 'question':
            node = (
              <DecisionCard
                card={card}
                lang={lang}
                onSubmit={(answers) => onAnswerQuestions?.(card.id, answers)}
                testID={`card-${card.id}`}
              />
            );
            break;

          case 'understanding':
            node = (
              <UnderstandingCard
                card={card}
                lang={lang}
                onConfirm={onConfirmUnderstanding}
                onReject={onRejectUnderstanding}
                testID={`card-${card.id}`}
              />
            );
            break;

          case 'steps':
            node = (
              <Card title={tDrawer(lang, 'request.stepsTitle')} status="working" testID={`card-${card.id}`}>
                <StepBar steps={card.steps} lang={lang} />
              </Card>
            );
            break;

          case 'wait':
            node = <WaitCard card={card} lang={lang} testID={`card-${card.id}`} />;
            break;

          case 'code':
            node = (
              <CodeCard
                card={card}
                lang={lang}
                onRetryPush={onRetryCodePush}
                testID={`card-${card.id}`}
              />
            );
            break;

          default: {
            const isUnknown = card.kind === 'unknown';
            const signedTitleKey =
              card.kind === 'start'
                ? 'request.signedCard.start'
                : card.kind === 'changes'
                  ? 'request.signedCard.changes'
                  : card.kind === 'delivery'
                    ? 'request.signedCard.delivery'
                    : card.kind === 'release'
                      ? 'request.signedCard.release'
                      : 'request.signedCard.generic';
            node = (
              <Card
                title={isUnknown ? tDrawer(lang, 'request.unknownTitle') : tDrawer(lang, signedTitleKey)}
                status={isUnknown ? 'waiting' : 'needs-you'}
                testID={`card-${card.id}`}
              >
                <Text style={[styles.placeholder, { color: color.text2 }]}>
                  {isUnknown ? tDrawer(lang, 'request.unknownBody') : tDrawer(lang, 'request.signedCardBody')}
                </Text>
              </Card>
            );
            break;
          }
        }

        return (
          <View
            key={card.id}
            testID={`card-slot-${card.id}`}
            onLayout={(e) => onCardLayout?.(card.id, e.nativeEvent.layout.y)}
            style={
              isHighlighted
                ? [styles.highlighted, { borderColor: color.info, borderRadius: radius.l }]
                : undefined
            }
          >
            {node}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[4] },
  placeholder: { ...type.callout },
  highlighted: { borderWidth: 2, padding: 2 },
});
