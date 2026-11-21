import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { z } from 'zod';
import type { StudioDecision } from '../../../src/studio/protocol';
import { detectLang, type Lang } from '../lib/strings';
import { tQuestions } from '../lib/strings/questions';
import { color, space, type } from '../lib/theme';
import { undoStore } from '../lib/undo';
import { appendSpoken, useVoiceDictation } from '../lib/voice';
import type { QuestionCardSchema, QuestionItemSchema } from '../lib/views';
import { Card } from './card/Card';
import { GoalInput } from './GoalInput';
import { PrimaryButton } from './PrimaryButton';

export type QuestionCardData = z.infer<typeof QuestionCardSchema>;
export type QuestionItemData = z.infer<typeof QuestionItemSchema> & { readonly multi?: boolean };

export interface QuestionAnswerItem {
  readonly questionId: string;
  readonly picks: readonly string[];
  readonly customText?: string;
}

export interface QuestionCardProps {
  readonly card: QuestionCardData;
  readonly lang?: Lang;
  /**
   * 每条问题一条回答（一题一个 decision.answer）：没改的 `picks` 是第一个选项，
   * 改过的 `picks` 为空、`customText` 是客户自己写的。返回 false 或抛错视为发送失败。
   */
  readonly onSubmit?: (answers: QuestionAnswerItem[]) => Promise<boolean | void> | boolean | void;
  readonly testID?: string;
}

/** 兼容旧版 app/plan/[id].tsx 的调用方式（SS-117 移除旧路由后可删除）。 */
export interface LegacyDecisionCardProps {
  readonly pid: string;
  readonly planRef: string;
  readonly decision: StudioDecision;
  readonly index: number;
  readonly total: number;
  readonly lang: Lang;
  readonly onAnswered: (decisionId: string) => void;
  readonly onRefresh: () => void;
  readonly testID?: string;
}

export type DecisionCardProps = QuestionCardProps | LegacyDecisionCardProps;

/** 一次最多三条；其余的在对话里说。 */
const MAX_SHOWN = 3;
const UNDO_MS = 4_000;

function isLegacyProps(props: DecisionCardProps): props is LegacyDecisionCardProps {
  return 'decision' in props;
}

function normalizeQuestions(card: QuestionCardData): QuestionItemData[] {
  if (card.questions && card.questions.length > 0) {
    return card.questions.map((q, idx) => ({
      ...q,
      index: q.index || idx + 1,
    }));
  }
  return [
    {
      id: card.id,
      index: card.index ?? 1,
      prompt: card.prompt,
      options: card.options,
      allowFreeText: card.allowFreeText,
      answer: card.answer,
    },
  ];
}

/**
 * P3 问题卡（决定 questions-confirm / SS-252）：每条问题一个建议答案「我先按：…」和一个「改…」，
 * 底部一个实底「就这样」整体确认。不给选项行、药丸、编号或「还差 N 题」；
 * 点「就这样」先走 4 秒撤销条，失败回到可再点并说明原因。
 */
export function DecisionCard(props: DecisionCardProps) {
  if (isLegacyProps(props)) {
    const legacyCard: QuestionCardData = {
      id: props.decision.decisionId,
      kind: 'question',
      createdAt: 0,
      status: 'pending',
      index: props.index + 1,
      total: props.total,
      prompt: props.decision.question,
      options: props.decision.options,
      allowFreeText: true,
      questions: [
        {
          id: props.decision.decisionId,
          index: props.index + 1,
          prompt: props.decision.question,
          options: props.decision.options,
          allowFreeText: true,
        },
      ],
    };
    return (
      <QuestionCardInner
        card={legacyCard}
        lang={props.lang}
        testID={props.testID}
        onSubmit={() => {
          props.onAnswered(props.decision.decisionId);
        }}
      />
    );
  }
  return <QuestionCardInner {...props} />;
}

function QuestionCardInner({ card, lang: langProp, onSubmit, testID = 'decision-card' }: QuestionCardProps) {
  const lang = langProp ?? detectLang();
  const questions = normalizeQuestions(card);
  const shown = questions.slice(0, MAX_SHOWN);
  const hidden = questions.length - shown.length;

  /** 每条自己写的内容；空字符串等于没改，仍按建议答案发。 */
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(card.status === 'done');
  const [sendError, setSendError] = useState<string | null>(null);

  const answersOf = (): QuestionAnswerItem[] => {
    const out: QuestionAnswerItem[] = [];
    for (const q of shown) {
      const own = (texts[q.id] ?? '').trim();
      if (own) {
        out.push({ questionId: q.id, picks: [], customText: own });
        continue;
      }
      const first = q.options?.[0];
      if (first) out.push({ questionId: q.id, picks: [first.id] });
    }
    return out;
  };

  const deliver = async (answers: QuestionAnswerItem[]) => {
    try {
      const result = await onSubmit?.(answers);
      if (result === false) throw new Error('send-failed');
      setSubmitted(true);
    } catch {
      setSubmitted(false);
      setSendError(tQuestions(lang, 'questions.sendFailed'));
    }
  };

  const handleSubmit = () => {
    if (submitted) return;
    const answers = answersOf();
    if (answers.length === 0) return;
    setSendError(null);
    setSubmitted(true);
    undoStore.show({
      text: tQuestions(lang, 'questions.undo'),
      ms: UNDO_MS,
      fire: () => {
        void deliver(answers);
      },
      onUndo: () => {
        setSubmitted(false);
      },
    });
  };

  const footer = submitted ? (
    <Text style={[styles.submittedNote, { color: color.ok }]} testID="questions-submitted">
      {tQuestions(lang, 'questions.submitted')}
    </Text>
  ) : (
    <PrimaryButton
      label={tQuestions(lang, 'questions.submit')}
      state="idle"
      error={sendError}
      onPress={handleSubmit}
      testID="questions-submit"
    />
  );

  return (
    <Card
      title={submitted ? tQuestions(lang, 'questions.cardTitleDone') : tQuestions(lang, 'questions.cardTitle')}
      status={submitted ? 'done' : 'needs-you'}
      footer={footer}
      testID={testID}
    >
      <View style={styles.questionsList}>
        {shown.map((q) => (
          <QuestionRow
            key={q.id}
            q={q}
            lang={lang}
            text={texts[q.id] ?? ''}
            editing={editingId === q.id}
            locked={submitted}
            onEdit={() => setEditingId(q.id)}
            onDoneEditing={() => setEditingId(null)}
            onRevert={() => {
              setEditingId(null);
              setTexts((prev) => ({ ...prev, [q.id]: '' }));
            }}
            onChangeText={(next) => setTexts((prev) => ({ ...prev, [q.id]: next }))}
          />
        ))}
        {hidden > 0 ? (
          <Text style={[styles.moreInChat, { color: color.text3 }]} testID="questions-more">
            {tQuestions(lang, 'questions.moreInChat', { n: hidden })}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

function QuestionRow({
  q,
  lang,
  text,
  editing,
  locked,
  onEdit,
  onDoneEditing,
  onRevert,
  onChangeText,
}: {
  readonly q: QuestionItemData;
  readonly lang: Lang;
  readonly text: string;
  readonly editing: boolean;
  readonly locked: boolean;
  readonly onEdit: () => void;
  readonly onDoneEditing: () => void;
  readonly onRevert: () => void;
  readonly onChangeText: (next: string) => void;
}) {
  const own = text.trim();
  const suggested = q.options?.[0];
  const voice = useVoiceDictation({
    lang,
    onTranscript: (spoken) => onChangeText(appendSpoken(text, spoken)),
  });

  return (
    <View style={styles.questionBlock} testID={`question-item-${q.id}`}>
      <Text style={[styles.prompt, { color: color.text }]}>{q.prompt}</Text>

      <View style={styles.answerRow}>
        {own ? (
          <Text style={[styles.answer, { color: color.text2 }]} testID={`question-${q.id}-changed`}>
            {tQuestions(lang, 'questions.changed', { text: own })}
          </Text>
        ) : suggested ? (
          <Text style={[styles.answer, { color: color.text2 }]} testID={`question-${q.id}-suggested`}>
            {tQuestions(lang, 'questions.suggested', { answer: suggested.label })}
          </Text>
        ) : (
          <View style={styles.answerSpacer} />
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: locked }}
          disabled={locked}
          onPress={own ? onRevert : onEdit}
          hitSlop={8}
          style={({ pressed }) => [styles.link, pressed && !locked && styles.pressed]}
          testID={own ? `question-${q.id}-revert` : `question-${q.id}-change`}
        >
          <Text style={[styles.linkLabel, { color: locked ? color.text3 : color.info }]}>
            {own ? tQuestions(lang, 'questions.revert') : tQuestions(lang, 'questions.change')}
          </Text>
        </Pressable>
      </View>

      {editing ? (
        <View style={styles.editWrap}>
          <GoalInput
            value={text}
            onChangeText={onChangeText}
            lang={lang}
            maxHeight={160}
            placeholder={tQuestions(lang, 'questions.editPlaceholder')}
            accessibilityLabel={tQuestions(lang, 'questions.editPlaceholder')}
            voice={{
              listening: voice.phase !== 'idle',
              onStart: () => void voice.start(),
              onStop: () => void voice.stop(),
              onCancel: voice.cancel,
              hint: voice.hint,
              disabled: locked,
            }}
            testID={`question-${q.id}-edit-input`}
          />
          <Pressable
            accessibilityRole="button"
            onPress={onDoneEditing}
            hitSlop={8}
            style={({ pressed }) => [styles.link, styles.done, pressed && styles.pressed]}
            testID={`question-${q.id}-edit-done`}
          >
            <Text style={[styles.linkLabel, { color: color.text2 }]}>{tQuestions(lang, 'questions.editDone')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  questionsList: { gap: space[5] },
  questionBlock: { gap: space[2] },
  prompt: { ...type.callout, fontWeight: '600' },
  answerRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  answer: { ...type.callout, flex: 1 },
  answerSpacer: { flex: 1 },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[1] },
  linkLabel: { ...type.callout, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  editWrap: { gap: space[1] },
  done: { alignSelf: 'flex-end' },
  moreInChat: { ...type.caption },
  submittedNote: { ...type.callout, fontWeight: '600' },
});
