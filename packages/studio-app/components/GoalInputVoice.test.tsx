import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { describe, expect, it, vi } from 'vitest';
import { appendSpoken, useVoiceDictation, type VoiceRecognizer } from '../lib/voice';
import { GoalInput } from './GoalInput';

// lib/appearance 读 kv，kv 用 expo-file-system；node 下没有原生模块，给个空的。
vi.mock('expo-file-system', () => ({
  Paths: { document: '/mock-doc' },
  File: class {},
}));

vi.mock('lucide-react-native', () => ({
  Mic: () => null,
  X: () => null,
  Check: () => null,
}));

const fakeRecognizer = (text: string): VoiceRecognizer => ({
  requestPermission: async () => ({ granted: true }),
  start: async () => {},
  stop: async () => text,
  cancel: async () => {},
});

/** 真正的 useVoiceDictation + 假的识别器，输入框和语音按屏幕上的方式接起来。 */
function VoiceHarness({ recognizer }: { readonly recognizer: VoiceRecognizer }) {
  const [value, setValue] = useState('');
  const voice = useVoiceDictation({
    lang: 'zh',
    onTranscript: (text) => setValue((prev) => appendSpoken(prev, text)),
    recognizer,
  });
  return (
    <View>
      <GoalInput
        value={value}
        onChangeText={setValue}
        lang="zh"
        maxHeight={300}
        placeholder="输入需求"
        accessibilityLabel="输入需求"
        voice={{
          listening: voice.phase !== 'idle',
          onStart: () => void voice.start(),
          onStop: () => void voice.stop(),
          onCancel: voice.cancel,
          hint: voice.hint,
        }}
      />
      <Text testID="voice-value">{value}</Text>
    </View>
  );
}

describe('GoalInput voice（SS-219）', () => {
  it('录音时有「完成」和「取消」两个按钮，点完成把文字写进输入框', async () => {
    const { getByTestId, queryByTestId } = await render(
      <VoiceHarness recognizer={fakeRecognizer('增加微信一键登录')} />,
    );

    expect(queryByTestId('voice-mic-btn')).toBeTruthy();
    expect(queryByTestId('voice-stop-btn')).toBeNull();

    await fireEvent.press(getByTestId('voice-mic-btn'));
    await waitFor(() => expect(getByTestId('voice-stop-btn')).toBeTruthy());
    expect(getByTestId('voice-cancel-btn')).toBeTruthy();

    await fireEvent.press(getByTestId('voice-stop-btn'));
    await waitFor(() =>
      expect(getByTestId('voice-value').props.children).toBe('增加微信一键登录'),
    );
    expect(queryByTestId('voice-stop-btn')).toBeNull();
    expect(getByTestId('voice-mic-btn')).toBeTruthy();
  });

  it('点取消丢掉这段，输入框不变', async () => {
    const { getByTestId, queryByTestId } = await render(
      <VoiceHarness recognizer={fakeRecognizer('不应该写进来')} />,
    );

    await fireEvent.press(getByTestId('voice-mic-btn'));
    await waitFor(() => expect(getByTestId('voice-cancel-btn')).toBeTruthy());
    await fireEvent.press(getByTestId('voice-cancel-btn'));

    await waitFor(() => expect(getByTestId('voice-mic-btn')).toBeTruthy());
    expect(getByTestId('voice-value').props.children).toBe('');
    expect(queryByTestId('voice-stop-btn')).toBeNull();
  });
});
