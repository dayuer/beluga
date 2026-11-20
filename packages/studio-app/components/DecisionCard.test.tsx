import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'zh' }] }));
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

import { setScheme } from '../lib/theme';
import { DecisionCard, type QuestionCardData } from './DecisionCard';

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

describe('DecisionCard (P3 问题卡)', () => {
  it('numbers each question, shows remaining count beside disabled submit, and submits all together', async () => {
    setScheme('light');
    const onSubmit = vi.fn().mockResolvedValue(true);
    const screen = await render(<DecisionCard card={TWO_QUESTIONS} lang="zh" onSubmit={onSubmit} />);

    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
    expect(screen.getByTestId('questions-action-row')).toBeTruthy();
    expect(screen.getByText('还差 2 题')).toBeTruthy();
    expect(screen.getByTestId('questions-submit').props.accessibilityState.disabled).toBe(true);

    // 回答第 1 题
    await fireEvent.press(screen.getByTestId('question-q1-option-opt-sms'));
    expect(screen.getByText('还差 1 题')).toBeTruthy();
    expect(screen.getByTestId('questions-submit').props.accessibilityState.disabled).toBe(true);

    // 第 2 题选择「自己写…」
    await fireEvent.press(screen.getByTestId('question-q2-write-own'));
    expect(screen.getByText('还差 1 题')).toBeTruthy();
    const customInput = screen.getByTestId('question-q2-custom-input');
    const flatStyle = Object.assign({}, ...(Array.isArray(customInput.props.style) ? customInput.props.style : [customInput.props.style]));
    expect(flatStyle.fontSize).toBe(16);
    await fireEvent.changeText(customInput, '提示用户先注册');

    // 全部答完：还差提示消失，主按钮可点
    expect(screen.queryByText(/还差/)).toBeNull();
    expect(screen.getByTestId('questions-submit').props.accessibilityState.disabled).toBe(false);

    // 一起提交
    await fireEvent.press(screen.getByTestId('questions-submit'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith([
      { questionId: 'q1', picks: ['opt-sms'] },
      { questionId: 'q2', picks: [], customText: '提示用户先注册' },
    ]);
    await waitFor(() => {
      expect(screen.getByTestId('questions-submitted')).toBeTruthy();
    });
  });

  it('keeps selections when sending fails', async () => {
    setScheme('light');
    const onSubmit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const card: QuestionCardData = { ...TWO_QUESTIONS, id: 'card-q-fail' };
    const screen = await render(<DecisionCard card={card} lang="zh" onSubmit={onSubmit} />);

    await fireEvent.press(screen.getByTestId('question-q1-option-opt-captcha'));
    await fireEvent.press(screen.getByTestId('question-q2-option-opt-auto'));
    await fireEvent.press(screen.getByTestId('questions-submit'));

    await waitFor(() => {
      expect(screen.getByText('发送失败，已保留你的选择，请重试')).toBeTruthy();
    });

    // 已选内容仍在
    expect(screen.getByTestId('question-q1-option-opt-captcha').props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId('question-q2-option-opt-auto').props.accessibilityState.checked).toBe(true);

    // 可以直接重试
    await fireEvent.press(screen.getByTestId('questions-submit'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('questions-submitted')).toBeTruthy();
    });
  });
});
