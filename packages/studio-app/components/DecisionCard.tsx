import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { z } from 'zod';
import type { StudioDecision } from '../../../src/studio/protocol';
import { kv } from '../lib/kv';
import { detectLang, type Lang } from '../lib/strings';
import { tQuestions } from '../lib/strings/questions';
import { color, radius, space, type } from '../lib/theme';
import type { QuestionCardSchema, QuestionItemSchema } from '../lib/views';
import { ActionRow } from './card/ActionRow';
import { Card } from './card/Card';
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
  /** 全部答完后一起发送；返回 false 或抛错视为发送失败（不清空已选）。 */
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

interface QuestionDraft {
  readonly picks: string[];
  readonly writeOwn: boolean;
  readonly customText: string;
}

const MAX_ANSWER = 2000;

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

function isQuestionAnswered(draft: QuestionDraft | undefined): boolean {
  if (!draft) return false;
  if (draft.picks.length > 0) return true;
  return draft.writeOwn && draft.customText.trim().length > 0;
}

/**
 * P3 问题卡（SS-42）：每题编号、单选/多选加「自己写…」、全部答完主按钮才可点，一起发一个动作。
 * 使用 `Card` 外框；发送失败不丢已选。
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
  const draftKey = `draft:questions:${card.id}`;

  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>(() => {
    const saved = kv.get<Record<string, QuestionDraft>>(draftKey);
    return saved && typeof saved === 'object' ? saved : {};
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(card.status === 'done');
  const [sendError, setSendError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const updateDraft = (questionId: string, next: QuestionDraft) => {
    setSendError(null);
    setDrafts((prev) => {
      const updated = { ...prev, [questionId]: next };
      kv.set(draftKey, updated);
      return updated;
    });
  };

  const toggleOption = (q: QuestionItemData, optionId: string) => {
    const cur = drafts[q.id] ?? { picks: [], writeOwn: false, customText: '' };
    if (q.multi) {
      const exists = cur.picks.includes(optionId);
      const picks = exists ? cur.picks.filter((id) => id !== optionId) : [...cur.picks, optionId];
      updateDraft(q.id, { ...cur, picks });
    } else {
      updateDraft(q.id, { ...cur, picks: [optionId], writeOwn: false });
    }
  };

  const toggleWriteOwn = (q: QuestionItemData) => {
    const cur = drafts[q.id] ?? { picks: [], writeOwn: false, customText: '' };
    if (q.multi) {
      updateDraft(q.id, { ...cur, writeOwn: !cur.writeOwn });
    } else {
      updateDraft(q.id, { ...cur, picks: [], writeOwn: true });
    }
  };

  const setCustomText = (q: QuestionItemData, value: string) => {
    const cur = drafts[q.id] ?? { picks: [], writeOwn: true, customText: '' };
    updateDraft(q.id, { ...cur, writeOwn: true, customText: value.slice(0, MAX_ANSWER) });
  };

  const answeredCount = questions.filter((q) => isQuestionAnswered(drafts[q.id])).length;
  const remaining = Math.max(0, questions.length - answeredCount);
  const allAnswered = remaining === 0;

  const handleSubmit = async () => {
    if (!allAnswered || submitting || submitted) return;
    setSubmitting(true);
    setSendError(null);
    const payload: QuestionAnswerItem[] = questions.map((q) => {
      const d = drafts[q.id] ?? { picks: [], writeOwn: false, customText: '' };
      const trimmed = d.customText.trim();
      return {
        questionId: q.id,
        picks: d.picks,
        ...(d.writeOwn && trimmed ? { customText: trimmed } : {}),
      };
    });
    try {
      const result = await onSubmit?.(payload);
      if (result === false) {
        setSendError(tQuestions(lang, 'questions.sendFailed'));
        setAttempt((a) => a + 1);
        return;
      }
      kv.remove(draftKey);
      setSubmitted(true);
    } catch {
      setSendError(tQuestions(lang, 'questions.sendFailed'));
      setAttempt((a) => a + 1);
    } finally {
      setSubmitting(false);
    }
  };

  const footer = submitted ? (
    <Text style={[styles.submittedNote, { color: color.ok }]} testID="questions-submitted">
      {tQuestions(lang, 'questions.submitted')}
    </Text>
  ) : (
    <ActionRow
      testID="questions-action-row"
      hint={remaining > 0 ? tQuestions(lang, 'questions.remaining', { n: remaining }) : undefined}
      primary={
        <PrimaryButton
          key={attempt}
          label={
            submitting
              ? tQuestions(lang, 'questions.submitting')
              : sendError
                ? tQuestions(lang, 'questions.retry')
                : tQuestions(lang, 'questions.submit')
          }
          state={submitting ? 'working' : 'idle'}
          disabled={!allAnswered || submitting}
          error={sendError}
          onPress={() => void handleSubmit()}
          testID="questions-submit"
        />
      }
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
        {questions.map((q, idx) => {
          const draft = drafts[q.id] ?? { picks: [], writeOwn: false, customText: '' };
          const num = q.index || idx + 1;
          const allowFree = q.allowFreeText !== false;
          const options = q.options ?? [];

          return (
            <View key={q.id} style={styles.questionBlock} testID={`question-item-${q.id}`}>
              <View style={styles.promptRow}>
                <Text style={[styles.num, { color: color.text3 }]}>{tQuestions(lang, 'questions.number', { i: num })}</Text>
                <View style={styles.promptWrap}>
                  <Text style={[styles.prompt, { color: color.text }]}>{q.prompt}</Text>
                  {q.multi ? (
                    <Text style={[styles.multiHint, { color: color.text3 }]}>{tQuestions(lang, 'questions.multiHint')}</Text>
                  ) : null}
                </View>
              </View>

              {submitted && q.answer ? (
                <Text style={[styles.answerSummary, { color: color.text2 }]}>{q.answer}</Text>
              ) : (
                <View style={styles.optionsList}>
                  {options.map((opt) => {
                    const selected = draft.picks.includes(opt.id);
                    return (
                      <Pressable
                        key={opt.id}
                        accessibilityRole={q.multi ? 'checkbox' : 'radio'}
                        accessibilityState={{ checked: selected, disabled: submitted || submitting }}
                        disabled={submitted || submitting}
                        onPress={() => toggleOption(q, opt.id)}
                        style={({ pressed }) => [
                          styles.option,
                          {
                            backgroundColor: color.card,
                            borderColor: selected ? color.text : color.hairline,
                            borderWidth: selected ? 1.5 : 1,
                          },
                          pressed && styles.pressed,
                        ]}
                        testID={`question-${q.id}-option-${opt.id}`}
                      >
                        <View
                          style={[
                            styles.check,
                            q.multi && styles.checkSquare,
                            {
                              borderColor: selected ? color.text : color.hairlineStrong,
                              backgroundColor: selected ? color.text : 'transparent',
                            },
                          ]}
                        >
                          {selected ? <Text style={[styles.checkInk, { color: color.onPrimary }]}>✓</Text> : null}
                        </View>
                        <View style={styles.optionCopy}>
                          <Text style={[styles.optionLabel, { color: color.text }]}>{opt.label}</Text>
                          {opt.description ? (
                            <Text style={[styles.optionDesc, { color: color.text2 }]}>{opt.description}</Text>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}

                  {allowFree ? (
                    <View style={styles.writeOwnWrap}>
                      <Pressable
                        accessibilityRole={q.multi ? 'checkbox' : 'radio'}
                        accessibilityState={{ checked: draft.writeOwn, disabled: submitted || submitting }}
                        disabled={submitted || submitting}
                        onPress={() => toggleWriteOwn(q)}
                        style={({ pressed }) => [
                          styles.option,
                          {
                            backgroundColor: color.card,
                            borderColor: draft.writeOwn ? color.text : color.hairline,
                            borderWidth: draft.writeOwn ? 1.5 : 1,
                          },
                          pressed && styles.pressed,
                        ]}
                        testID={`question-${q.id}-write-own`}
                      >
                        <View
                          style={[
                            styles.check,
                            q.multi && styles.checkSquare,
                            {
                              borderColor: draft.writeOwn ? color.text : color.hairlineStrong,
                              backgroundColor: draft.writeOwn ? color.text : 'transparent',
                            },
                          ]}
                        >
                          {draft.writeOwn ? <Text style={[styles.checkInk, { color: color.onPrimary }]}>✓</Text> : null}
                        </View>
                        <Text style={[styles.optionLabel, { color: color.text }]}>{tQuestions(lang, 'questions.writeOwn')}</Text>
                      </Pressable>

                      {draft.writeOwn ? (
                        <TextInput
                          value={draft.customText}
                          onChangeText={(val) => setCustomText(q, val)}
                          placeholder={tQuestions(lang, 'questions.writePlaceholder')}
                          placeholderTextColor={color.text3}
                          editable={!submitted && !submitting}
                          multiline
                          maxLength={MAX_ANSWER}
                          style={[
                            styles.input,
                            {
                              color: color.text,
                              backgroundColor: color.sunken,
                              borderColor: color.hairline,
                            },
                          ]}
                          testID={`question-${q.id}-custom-input`}
                          accessibilityLabel={tQuestions(lang, 'questions.writePlaceholder')}
                        />
                      ) : null}
                    </View>
                  ) : null}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  questionsList: { gap: space[5] },
  questionBlock: { gap: space[2] },
  promptRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  num: { ...type.callout, fontWeight: '700', minWidth: 20 },
  promptWrap: { flex: 1, gap: 2 },
  prompt: { ...type.callout, fontWeight: '600' },
  multiHint: { ...type.caption },
  answerSummary: { ...type.callout, paddingLeft: 28 },
  optionsList: { gap: space[2], paddingLeft: 28 },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.m,
  },
  pressed: { opacity: 0.88 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSquare: { borderRadius: 5 },
  checkInk: { fontSize: 12, fontWeight: '800' },
  optionCopy: { flex: 1 },
  optionLabel: { ...type.callout, fontWeight: '500' },
  optionDesc: { ...type.caption, marginTop: 2 },
  writeOwnWrap: { gap: space[2] },
  input: {
    ...type.callout,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 44,
    maxHeight: 100,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderRadius: radius.m,
    padding: space[3],
  },
  submittedNote: { ...type.callout, fontWeight: '600' },
});
