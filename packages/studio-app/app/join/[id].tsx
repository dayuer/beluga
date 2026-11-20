import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Fingerprint } from '../../components/Fingerprint';
import { Header } from '../../components/Header';
import { TextButton } from '../../components/TextButton';
import { enrollDevice, type EnrollErrorReason } from '../../lib/enrol';
import { detectLang } from '../../lib/strings';
import { joinT, type JoinStringKey } from '../../lib/strings/join';
import { color, radius, space, tint, type } from '../../lib/theme';

const REASON_KEY: Record<EnrollErrorReason, JoinStringKey> = {
  used: 'join.errUsed',
  expired: 'join.errExpired',
  'fingerprint-mismatch': 'join.errFingerprint',
  offline: 'join.errOffline',
  failed: 'join.errFailed',
};

/**
 * 邀请链接登记屏（SS-73）：
 * `/join/<inviteId>#k=<key>&n=<fingerprint>`。
 * 1) 先展示 `Fingerprint` 核对节点公钥指纹；
 * 2) 客户点「一致」后生成密钥并发 `device.enroll{pubkey, mac}`；
 * 3) 成功后进入需求首页 `/`，失败则写清一次性码已用、过期或指纹不符的原因。
 */
export default function JoinDeviceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; k?: string; n?: string }>();
  const lang = detectLang();
  const [busy, setBusy] = useState(false);
  const [errorReason, setErrorReason] = useState<EnrollErrorReason | null>(null);

  const invite = useMemo(() => {
    const id = typeof params.id === 'string' ? params.id.trim() : '';
    const k = typeof params.k === 'string' ? params.k.trim() : '';
    const n = typeof params.n === 'string' ? params.n.trim() : '';
    return id && k && n ? { inviteId: id, k, n } : null;
  }, [params.id, params.k, params.n]);

  const handleMatch = async () => {
    if (!invite || busy) return;
    setBusy(true);
    setErrorReason(null);
    const res = await enrollDevice(invite);
    setBusy(false);
    if (res.ok) {
      router.replace('/');
      return;
    }
    setErrorReason(res.reason);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: color.bg }]} edges={['top', 'bottom']}>
      <Header title={joinT(lang, 'join.title')} back />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.subtitle, { color: color.text2 }]}>{joinT(lang, 'join.subtitle')}</Text>

        {!invite ? (
          <View style={[styles.notice, { backgroundColor: tint.rose[0], borderColor: color.error }]}>
            <Text style={[styles.noticeText, { color: color.error }]}>{joinT(lang, 'join.invalidLink')}</Text>
            <TextButton label={joinT(lang, 'join.backHome')} onPress={() => router.replace('/')} />
          </View>
        ) : (
          <Fingerprint fingerprint={invite.n} onMatch={() => void handleMatch()} busy={busy} />
        )}

        {errorReason ? (
          <View style={[styles.notice, { backgroundColor: tint.rose[0], borderColor: color.error }]} testID="join-error">
            <Text style={[styles.noticeText, { color: color.error }]}>{joinT(lang, REASON_KEY[errorReason])}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: {
    padding: space[4],
    gap: space[4],
  },
  subtitle: {
    ...type.callout,
  },
  notice: {
    borderRadius: radius.m,
    borderWidth: 1,
    padding: space[4],
    gap: space[3],
  },
  noticeText: {
    ...type.callout,
  },
});
