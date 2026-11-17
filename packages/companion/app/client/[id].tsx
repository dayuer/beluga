import { useLocalSearchParams } from 'expo-router';
import type React from 'react';
import { useRef, useState } from 'react';
import { Linking, ScrollView, TextInput, View } from 'react-native';
import { ClientCards } from '../../components/ClientCards';
import { OutputGrid } from '../../components/Outputs';
import { Header, Screen } from '../../components/Screen';
import { Button, Card, Pill, Press, T } from '../../components/ui';
import { useView } from '../../lib/hooks';
import type { Call } from '../../lib/link/calls';
import type { ClientConvView, Topic } from '../../lib/link/protocol';
import { store } from '../../lib/store';
import { color } from '../../lib/theme';

/** 客户的一个对话:纯文字(代码已在 Mac 端去掉)、截图、预览链接、待确认卡片、发消息。 */
export default function ClientConversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const topic = `client:${decodeURIComponent(id ?? '')}` as Topic;
  const view = useView<ClientConvView>(topic);
  const c = view?.data;
  const [text, setText] = useState('');
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const send = (): void => {
    const words = text.trim();
    if (!words) return;
    setText('');
    const call = { method: 'session.submit', args: [words, { channel: `ws:${decodeURIComponent(id ?? '')}` }], label: '发送消息' } as unknown as Call;
    void store.call(call).catch((e: Error) => store.toast({ text: e.message, tone: 'error' }));
  };
  return (
    <Screen>
      <Header title={c?.title ?? '对话'} back eyebrow={c?.working ? '进行中' : undefined} />
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 12 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        {c?.more ? <T v="caption">更早的消息已收起</T> : null}
        {c?.turns.map((t) => (
          <View key={t.id} style={{ alignItems: t.who === 'you' ? 'flex-end' : 'flex-start', gap: 6 }}>
            {t.text ? (
              <Card style={{ maxWidth: '88%' }}>
                <T v="body">{t.text}</T>
              </Card>
            ) : null}
            {t.images.length ? <OutputGrid items={t.images} cols={2} /> : null}
            {t.links.map((u) => (
              <Press key={u} onPress={() => void Linking.openURL(u)}>
                <Pill label={`打开预览 · ${u.replace(/^https:\/\//, '').slice(0, 40)}`} tone="sky" />
              </Press>
            ))}
            {t.working ? <Pill label="正在处理…" tone="mint" /> : null}
          </View>
        ))}
        {c?.cards.length ? <ClientCards cards={c.cards} /> : null}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, padding: 12, alignItems: 'flex-end' }}>
        <TextInput value={text} onChangeText={setText} editable={c?.canSend !== false} placeholder="说说你的想法…" placeholderTextColor={color.text3} multiline style={{ flex: 1, color: color.text, fontSize: 15.5, paddingVertical: 8 }} />
        <Button label="发送" onPress={send} disabled={!text.trim()} />
      </View>
    </Screen>
  );
}
