import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { calls } from '../lib/link/calls';
import type { ClientCard, NeedsYou } from '../lib/link/protocol';
import { store } from '../lib/store';
import { color } from '../lib/theme';
import { Button, Card, T, haptic } from './ui';

/** 客户的确认卡片:一键“可以”,或写一句“要修改”。回答走和 Mac 一样的接口(白名单内)。 */
const asNeed = (c: ClientCard): NeedsYou => ({ ...c, topic: undefined }) as unknown as NeedsYou;

export function ClientCards({ cards }: { readonly cards: readonly ClientCard[] }) {
  return (
    <View style={{ gap: 10 }}>
      {cards.map((c) => (
        <CardView key={c.id} card={c} />
      ))}
    </View>
  );
}

function CardView({ card }: { readonly card: ClientCard }) {
  const [words, setWords] = useState('');
  const [editing, setEditing] = useState(false);
  const need = asNeed(card);
  const yes = card.actions.find((a) => a.tone === 'main');
  const no = card.actions.find((a) => a.tone === 'danger');
  const send = (value: string): void => {
    const c = calls.answer(need, value);
    if (!c) return;
    haptic.success();
    void store.answer(need, c, `已回复 · ${card.title}`);
  };
  return (
    <Card style={{ gap: 10 }}>
      <T v="title">{card.title}</T>
      {card.detail ? <T v="body">{card.detail}</T> : null}
      {card.choices?.map((ch) => (
        <Button key={ch.label} label={ch.label} quiet onPress={() => send(ch.label)} />
      ))}
      {yes ? <Button label="可以" onPress={() => void store.answer(need, calls.action(need, yes), `已确认 · ${card.title}`)} /> : null}
      {no || card.answer?.text ? (
        editing ? (
          <View style={{ gap: 8 }}>
            <TextInput value={words} onChangeText={setWords} placeholder="用一句话说说要改什么" placeholderTextColor={color.text3} style={{ color: color.text, fontSize: 15.5, paddingVertical: 8 }} multiline />
            <Button label="发送修改意见" disabled={!words.trim()} onPress={() => (card.answer?.text ? send(words.trim()) : undefined)} />
          </View>
        ) : (
          <Button label="要修改" quiet onPress={() => (card.answer?.text ? setEditing(true) : no ? void store.answer(need, calls.action(need, no), `已回复 · ${card.title}`) : undefined)} />
        )
      ) : null}
    </Card>
  );
}
