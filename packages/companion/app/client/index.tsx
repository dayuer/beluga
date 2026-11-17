import { router } from 'expo-router';
import { MessagesSquare } from 'lucide-react-native';
import { ScrollView, View } from 'react-native';
import { ClientCards } from '../../components/ClientCards';
import { Header, Screen, AwayBand } from '../../components/Screen';
import { Card, Pill, Press, Section, T, IconBadge } from '../../components/ui';
import { useLink, useView } from '../../lib/hooks';
import type { ClientHomeView } from '../../lib/link/protocol';

/** 客户的首页:它的项目、项目里的对话(带进度)、等它回答的卡片。没有文件、终端、代码。 */
export default function ClientHome() {
  const link = useLink();
  const view = useView<ClientHomeView>('client');
  const home = view?.data;
  return (
    <Screen>
      <Header title={home?.project.name ?? link.client?.name ?? '我的项目'} eyebrow="项目" />
      {view?.stale ? <AwayBand at={view.at} /> : null}
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {home?.cards.length ? (
          <Section title="等你确认">
            <ClientCards cards={home.cards} />
          </Section>
        ) : null}
        <Section title="对话与进度">
          {home?.conversations.length ? (
            home.conversations.map((c) => (
              <Press key={c.topic} onPress={() => router.push(`/client/${encodeURIComponent(c.topic.slice('client:'.length))}`)}>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <IconBadge Icon={MessagesSquare} tone="sky" size={34} />
                  <View style={{ flex: 1 }}>
                    <T v="body">{c.title}</T>
                  </View>
                  {c.cards ? <Pill label={`${c.cards} 项待确认`} tone="peach" /> : c.working ? <Pill label="进行中" tone="mint" /> : <Pill label="空闲" />}
                </Card>
              </Press>
            ))
          ) : (
            <T v="caption">{home ? '还没有对话,稍后再来看看。' : '正在连接…'}</T>
          )}
        </Section>
      </ScrollView>
    </Screen>
  );
}
