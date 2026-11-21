import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
vi.mock('expo-file-system', () => ({ Paths: { document: '/mock-doc' }, File: class {} }));
vi.mock('lucide-react-native', () => ({ Mic: () => null, X: () => null, Check: () => null }));
vi.mock('../lib/kv', () => {
  const mem = new Map<string, unknown>();
  return {
    kv: {
      get: (k: string) => mem.get(k),
      set: (k: string, v: unknown) => mem.set(k, v),
      remove: (k: string) => mem.delete(k),
    },
  };
});
vi.mock('../lib/voice-recognizer', () => ({ createVoiceRecognizer: () => ({}) }));

import { setScheme } from '../lib/theme';
import { undoStore } from '../lib/undo';
import { DecisionCard, type QuestionCardData } from './DecisionCard';
import { UndoBar } from './UndoBar';

const TWO_QUESTIONS: QuestionCardData = {
  id: 'card-q-test',
  kind: 'question',
  createdAt: 1000,
  status: 'pending',
  prompt: '问题 1',
  allowFreeText: true,
  questions: [
    {
      id: 'q1',
      index: 1,
      prompt: '登录失败超过 5 次时，需要图形验证码还是短信验证码？',
      options: [
        { id: 'opt-sms', label: '短信验证码' },
        { id: 'opt-captcha', label: '图形验证码' },
      ],
      allowFreeText: true,
    },
    {
      id: 'q2',
      index: 2,
      prompt: '未注册手机号一键登录时是否自动创建账号？',
      options: [
        { id: 'opt-auto', label: '自动创建并登录' },
        { id: 'opt-bind', label: '先引导绑定已有账号' },
      ],
      allowFreeText: true,
    },
  ],
};

const FOUR_QUESTIONS: QuestionCardData = {
  ...TWO_QUESTIONS,
  id: 'card-q-four',
  questions: [
    ...TWO_QUESTIONS.questions!,
    { id: 'q3', index: 3, prompt: '第三个问题', options: [{ id: 'o3', label: '第三个建议' }], allowFreeText: true },
    { id: 'q4', index: 4, prompt: '第四个问题', options: [{ id: 'o4', label: '第四个建议' }], allowFreeText: true },
  ],
};

describe('DecisionCard (P3 问题卡 · 就这样 / 改…)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    undoStore.cancel();
    setScheme('light');
  });

  afterEach(async () => {
    undoStore.cancel();
    await cleanup();
    vi.useRealTimers();
  });

  it('shows each suggestion as 「我先按：…」 with a 「改…」 link and one solid 「就这样」, no option rows or remaining count', async () => {
    const screen = await render(<DecisionCard card={TWO_QUESTIONS} lang="zh" onSubmit={vi.fn()} />);

    expect(screen.getByText('我先按：短信验证码')).toBeTruthy();
    expect(screen.getByText('我先按：自动创建并登录')).toBeTruthy();
    expect(screen.getAllByText('改…')).toHaveLength(2);
    expect(screen.getByText('就这样')).toBeTruthy();
    expect(screen.getByTestId('questions-submit')).toBeTruthy();

    // 没有编号、选项行、「自己写…」、「还差 N 题」
    expect(screen.queryByText(/还差/)).toBeNull();
    expect(screen.queryByText(/自己写/)).toBeNull();
    expect(screen.queryByText('1.')).toBeNull();
    expect(screen.queryByTestId('question-q1-option-opt-sms')).toBeNull();
    expect(screen.queryByTestId('question-q2-write-own')).toBeNull();
  });

  it('tapping 「就这样」 sends the first option for every question', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const screen = await render(<DecisionCard card={TWO_QUESTIONS} lang="zh" onSubmit={onSubmit} />);

    await fireEvent.press(screen.getByTestId('questions-submit'));
    expect(onSubmit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith([
      { questionId: 'q1', picks: ['opt-sms'] },
      { questionId: 'q2', picks: ['opt-auto'] },
    ]);
    expect(screen.getByTestId('questions-submitted')).toBeTruthy();
  });

  it('sends the written text for the question changed with 「改…」 and the first option for the rest', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const screen = await render(<DecisionCard card={TWO_QUESTIONS} lang="zh" onSubmit={onSubmit} />);

    await fireEvent.press(screen.getByTestId('question-q2-change'));
    const input = screen.getByTestId('question-q2-edit-input');
    expect(Object.assign({}, ...[input.props.style].flat()).fontSize).toBe(16);
    await fireEvent.changeText(input, '先引导绑定，并记住这次选择');

    expect(screen.getByText('改成：先引导绑定，并记住这次选择')).toBeTruthy();
    expect(screen.queryByText('我先按：自动创建并登录')).toBeNull();

    // 点「改成」那行折起输入框；写了内容后旁边是「撤回」
    await fireEvent.press(screen.getByTestId('question-q2-dismiss'));
    expect(screen.queryByTestId('question-q2-edit-input')).toBeNull();
    expect(screen.getByTestId('question-q2-revert')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('questions-submit'));
    await vi.advanceTimersByTimeAsync(4000);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith([
      { questionId: 'q1', picks: ['opt-sms'] },
      { questionId: 'q2', picks: [], customText: '先引导绑定，并记住这次选择' },
    ]);
  });

  it('shows at most three questions and says the rest go in the chat', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const screen = await render(<DecisionCard card={FOUR_QUESTIONS} lang="zh" onSubmit={onSubmit} />);

    expect(screen.getByTestId('question-item-q1')).toBeTruthy();
    expect(screen.getByTestId('question-item-q3')).toBeTruthy();
    expect(screen.queryByTestId('question-item-q4')).toBeNull();
    expect(screen.getByTestId('questions-more')).toBeTruthy();
    expect(screen.getByText('还有 1 条，在对话里说就行')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('questions-submit'));
    await vi.advanceTimersByTimeAsync(4000);
    expect(onSubmit).toHaveBeenCalledWith([
      { questionId: 'q1', picks: ['opt-sms'] },
      { questionId: 'q2', picks: ['opt-auto'] },
      { questionId: 'q3', picks: ['o3'] },
    ]);
  });

  it('undoing within 4 seconds sends nothing and leaves the card answerable', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const screen = await render(
      <>
        <DecisionCard card={TWO_QUESTIONS} lang="zh" onSubmit={onSubmit} />
        <UndoBar />
      </>,
    );

    await fireEvent.press(screen.getByTestId('questions-submit'));
    expect(undoStore.getState().active).toBe(true);
    expect(screen.getByText(/已按建议答复/)).toBeTruthy();

    await fireEvent.press(screen.getByText('撤销'));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('questions-submit')).toBeTruthy();
    expect(screen.queryByTestId('questions-submitted')).toBeNull();
  });

  it('when sending fails, returns to a tappable button and says why', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('offline'));
    const screen = await render(<DecisionCard card={TWO_QUESTIONS} lang="zh" onSubmit={onSubmit} />);

    await fireEvent.press(screen.getByTestId('questions-submit'));
    await vi.advanceTimersByTimeAsync(4000);

    await vi.waitFor(() => {
      expect(screen.getByText('没发出去，请再点一次「就这样」')).toBeTruthy();
    });
    const submit = screen.getByTestId('questions-submit');
    expect(submit.props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByTestId('questions-submitted')).toBeNull();
  });
});
