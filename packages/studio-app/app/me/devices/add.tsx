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
 * 扫码加设备屏（SS-74）：
 * 用 `expo-camera` 扫描桌面端出示的邀请二维码（与 `/join/<inviteId>#k=&n=` 同格式），
 * 复用 `lib/enrol.ts` 与 `Fingerprint` 完成设备登记，成功后返回「设置 › 设备」。
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
      setScanError(
        lang === 'en'
          ? 'Not a valid device invite QR code. Point the camera at the QR code shown on desktop.'
          : '这不是有效的设备邀请二维码，请对准桌面端显示的二维码重试。',
      );
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
      <Header title={lang === 'en' ? 'Add a device' : '扫码加设备'} back />
      <ScrollView contentContainerStyle={styles.body}>
        {!permission ? (
          <Text style={[styles.hint, { color: color.text2 }]}>
            {lang === 'en' ? 'Checking camera permission…' : '正在检查相机权限…'}
          </Text>
        ) : !permission.granted ? (
          <View style={[styles.card, { backgroundColor: color.card, borderColor: color.hairline }]} testID="camera-denied">
            <Text style={[styles.cardTitle, { color: color.text }]}>
              {lang === 'en' ? 'Camera access needed' : '需要相机权限才能扫码'}
            </Text>
            <Text style={[styles.hint, { color: color.text2 }]}>
              {permission.canAskAgain
                ? lang === 'en'
                  ? 'Allow camera access to scan the invite QR code shown on your desktop.'
                  : '请允许使用相机，以扫描桌面端显示的设备邀请二维码。'
                : lang === 'en'
                  ? 'Camera permission was denied. Enable Camera in system Settings and come back.'
                  : '相机权限已被拒绝。请前往系统设置开启本应用的相机权限后再回来扫码。'}
            </Text>
            {permission.canAskAgain ? (
              <PrimaryButton
                label={lang === 'en' ? 'Allow camera' : '允许使用相机'}
                onPress={() => void requestPermission()}
              />
            ) : (
              <PrimaryButton
                label={lang === 'en' ? 'Open Settings' : '打开系统设置'}
                onPress={() => void Linking.openSettings()}
              />
            )}
          </View>
        ) : !invite ? (
          <View style={styles.scannerWrap}>
            <Text style={[styles.hint, { color: color.text2 }]}>
              {lang === 'en'
                ? 'Point your camera at the invite QR code on your desktop.'
                : '将镜头对准桌面端「加一台设备」出示的二维码：'}
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
            <TextButton label={lang === 'en' ? 'Scan a different code' : '重新扫码'} onPress={handleRescan} />
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
