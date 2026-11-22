import { StyleSheet, Text, View } from 'react-native';
import { detectLang, type Lang } from '../lib/strings';
import { tDrawer } from '../lib/strings/drawer';
import { color, radius, space, type } from '../lib/theme';
import type { StudioCard } from '../lib/views';
import { AcceptCard } from './AcceptCard';
import { Card } from './card/Card';
import { ChangeCard } from './cards/ChangeCard';
import { CodeCard } from './cards/CodeCard';
import { DeliveryCard } from './cards/DeliveryCard';
import { DesignCard } from './cards/DesignCard';
import { ReleaseCard } from './cards/ReleaseCard';
import { StartCard } from './cards/StartCard';
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
  /** 批准开工：签名动作 gate.answer（start）；卡内 4 秒撤销后才真正发出。 */
  readonly onStartPlan?: (cardId: string) => Promise<void> | void;
  /** 批准改动：签名动作 gate.answer（changes）。 */
  readonly onApproveChanges?: (cardId: string) => Promise<void> | void;
  /** 「先不改…」：不签名的 draft.discard。 */
  readonly onDeclineChanges?: (cardId: string) => void;
  /** 交付通过：签名动作 delivery.accept。 */
  readonly onAcceptDelivery?: (cardId: string) => Promise<void> | void;
  /** 交付卡「还不行…」：打开原因抽屉（milestone.sendBack）。 */
  readonly onNotYet?: (cardId: string) => void;
  /** 上线：签名动作 release.approve。 */
  readonly onRelease?: (cardId: string) => Promise<void> | void;
  /** 交付卡「去看看」：打开结果抽屉。 */
  readonly onOpenPreview?: (url?: string) => void;
  /** 开工卡「在结果区看计划」。 */
  readonly onOpenPlan?: () => void;
  /** 单测 / 预览用：覆盖设备密钥状态。 */
  readonly hasKeyOverride?: boolean;
  readonly testID?: string;
}

/** 同一张流里的步骤条给开工卡当步骤清单（开工卡只展示标题）。 */
function stepTitles(cards: readonly StudioCard[]): string[] | undefined {
  for (const card of cards) {
    if (card.kind === 'steps' && card.steps.length > 0) return card.steps.map((step) => step.title);
  }
  return undefined;
}

/**
 * 卡片流（SS-52 / SS-185 / SS-87）：按卡片类型 switch 渲染。
 * 不用签名的卡直接用；需要签名的卡（开工、改动、交付验收、上线）交给对应卡片组件，
 * 动作通过回调由需求详情页用 `useSend` 发出（签名在 `prepareActionForSend` 里补）。
 * 只有 `unknown` 留占位，支持 `?card=` 高亮与定位回调。
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
  onStartPlan,
  onApproveChanges,
  onDeclineChanges,
  onAcceptDelivery,
  onNotYet,
  onRelease,
  onOpenPreview,
  onOpenPlan,
  hasKeyOverride,
  testID = 'card-stream',
}: CardStreamProps) {
  const lang = langProp ?? detectLang();
  const steps = stepTitles(cards);

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

          case 'start':
            node = (
              <StartCard
                card={card}
                steps={steps}
                lang={lang}
                hasKeyOverride={hasKeyOverride}
                onStart={() => onStartPlan?.(card.id)}
                onOpenPlan={onOpenPlan}
                testID={`card-${card.id}`}
              />
            );
            break;

          case 'changes':
            node = (
              <ChangeCard
                card={card}
                lang={lang}
                hasKeyOverride={hasKeyOverride}
                onApprove={() => onApproveChanges?.(card.id)}
                onDecline={() => onDeclineChanges?.(card.id)}
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

          case 'delivery':
            // 还没通过：验收卡（通过 / 还不行…）；已通过（自动交付的通知）：交付卡。
            node =
              card.status === 'done' ? (
                <DeliveryCard
                  card={card}
                  lang={lang}
                  onOpenPreviewTab={(url) => onOpenPreview?.(url)}
                  testID={`card-${card.id}`}
                />
              ) : (
                <AcceptCard
                  card={card}
                  lang={lang}
                  hasKeyOverride={hasKeyOverride}
                  onNotYet={() => onNotYet?.(card.id)}
                  onSigned={() => onAcceptDelivery?.(card.id)}
                  onOpenPreview={(url) => onOpenPreview?.(url)}
                  testID={`card-${card.id}`}
                />
              );
            break;

          case 'release':
            node = (
              <ReleaseCard
                card={card}
                lang={lang}
                hasKeyOverride={hasKeyOverride}
                onRelease={() => onRelease?.(card.id)}
                testID={`card-${card.id}`}
              />
            );
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
            node = (
              <Card
                title={tDrawer(lang, 'request.unknownTitle')}
                status="waiting"
                testID={`card-${card.id}`}
              >
                <Text style={[styles.placeholder, { color: color.text2 }]}>
                  {tDrawer(lang, 'request.unknownBody')}
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
