import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Fingerprint } from '../../../components/Fingerprint';
import { Header } from '../../../components/Header';
import { PrimaryButton } from '../../../components/PrimaryButton';
import { TextButton } from '../../../components/TextButton';
import { enrollDevice, parseInvitePayload, type EnrollErrorReason, type InviteParams } from '../../../lib/enrol';
import { detectLang } from '../../../lib/strings';
import { joinT, type JoinStringKey } from '../../../lib/strings/join';
import { color, radius, space, tint, type } from '../../../lib/theme';

const REASON_KEY: Record<EnrollErrorReason, JoinStringKey> = {
  used: 'join.errUsed',
  expired: 'join.errExpired',
  'fingerprint-mismatch': 'join.errFingerprint',
  offline: 'join.errOffline',
  failed: 'join.errFailed',
};

/**
 * QR code device enrollment screen (SS-74 / SS-179).
 */
export default function AddDeviceScreen() {
  const router = useRouter();
  const lang = detectLang();
  const [permission, requestPermission] = useCameraPermissions();
  const [invite, setInvite] = useState<InviteParams | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorReason, setErrorReason] = useState<EnrollErrorReason | null>(null);
  const scanLock = useRef(false);

  const handleBarcodeScanned = (result: BarcodeScanningResult) => {
    if (scanLock.current || invite) return;
    const parsed = parseInvitePayload(result.data);
    if (!parsed) {
      setScanError(joinT(lang, 'add.invalidQr'));
      return;
    }
    scanLock.current = true;
    setScanError(null);
    setErrorReason(null);
    setInvite(parsed);
  };

  const handleEnroll = async () => {
    if (!invite || busy) return;
    setBusy(true);
    setErrorReason(null);
    const res = await enrollDevice(invite);
    setBusy(false);
    if (res.ok) {
      router.replace('/me/devices');
      return;
    }
    setErrorReason(res.reason);
  };

  const handleRescan = () => {
    scanLock.current = false;
    setInvite(null);
    setScanError(null);
    setErrorReason(null);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: color.bg }]} edges={['top', 'bottom']}>
      <Header title={joinT(lang, 'add.title')} back />
      <ScrollView contentContainerStyle={styles.body}>
        {!permission ? (
          <Text style={[styles.hint, { color: color.text2 }]}>
            {joinT(lang, 'add.checkingPermission')}
          </Text>
        ) : !permission.granted ? (
          <View style={[styles.card, { backgroundColor: color.card, borderColor: color.hairline }]} testID="camera-denied">
            <Text style={[styles.cardTitle, { color: color.text }]}>
              {joinT(lang, 'add.cameraTitle')}
            </Text>
            <Text style={[styles.hint, { color: color.text2 }]}>
              {permission.canAskAgain
                ? joinT(lang, 'add.cameraAskHint')
                : joinT(lang, 'add.cameraDeniedHint')}
            </Text>
            {permission.canAskAgain ? (
              <PrimaryButton
                label={joinT(lang, 'add.allowCamera')}
                onPress={() => void requestPermission()}
              />
            ) : (
              <PrimaryButton
                label={joinT(lang, 'add.openSettings')}
                onPress={() => void Linking.openSettings()}
              />
            )}
          </View>
        ) : !invite ? (
          <View style={styles.scannerWrap}>
            <Text style={[styles.hint, { color: color.text2 }]}>
              {joinT(lang, 'add.scanHint')}
            </Text>
            <View style={[styles.cameraFrame, { borderColor: color.hairline }]}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={handleBarcodeScanned}
              />
            </View>
            {scanError ? (
              <View style={[styles.notice, { backgroundColor: tint.rose[0], borderColor: color.error }]}>
                <Text style={[styles.noticeText, { color: color.error }]}>{scanError}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.scannerWrap}>
            <Fingerprint fingerprint={invite.n} onMatch={() => void handleEnroll()} busy={busy} />
            {errorReason ? (
              <View style={[styles.notice, { backgroundColor: tint.rose[0], borderColor: color.error }]}>
                <Text style={[styles.noticeText, { color: color.error }]}>{joinT(lang, REASON_KEY[errorReason])}</Text>
              </View>
            ) : null}
            <TextButton label={joinT(lang, 'add.rescan')} onPress={handleRescan} />
          </View>
        )}
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
  hint: {
    ...type.callout,
  },
  card: {
    borderRadius: radius.m,
    borderWidth: 1,
    padding: space[4],
    gap: space[3],
  },
  cardTitle: {
    ...type.heading,
  },
  scannerWrap: {
    gap: space[3],
  },
  cameraFrame: {
    height: 300,
    borderRadius: radius.m,
    borderWidth: 1,
    overflow: 'hidden',
  },
  camera: {
    flex: 1,
  },
  notice: {
    borderRadius: radius.m,
    borderWidth: 1,
    padding: space[4],
  },
  noticeText: {
    ...type.callout,
  },
});
