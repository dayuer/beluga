import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useKeyboardInset } from '../lib/viewport';
import { color, radius, space, type } from '../lib/theme';

interface DrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly testID?: string;
  /** The customer app uses a sheet on phones and a centered layer in the main column on desktop. */
  readonly variant?: 'sheet' | 'modal';
  readonly initialSnap?: 0.55 | 0.8;
}

const MIN_SNAP = 0.55;
const MAX_SNAP = 0.8;

/**
 * The bottom sheet behind decisions, reasons, changes and chat (M6 §4.8): two snaps, a draggable
 * handle, a 44pt close, and a bottom edge that rides the keyboard. On desktop it becomes a
 * centered layer instead. It owns no content and no actions.
 */
export function Drawer({ open, onClose, title, children, footer, testID = 'drawer', variant = 'sheet', initialSnap = MIN_SNAP }: DrawerProps) {
  const { width, height } = useWindowDimensions();
  const inset = useKeyboardInset();
  const modal = variant === 'modal' || width >= 900;
  const visible = Math.max(240, height - inset);
  const [snap, setSnap] = useState<number>(initialSnap);
  const [drag, setDrag] = useState(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      setSnap(initialSnap);
      setDrag(0);
    }
  }, [open, initialSnap]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
        onPanResponderMove: (_, gesture) => setDrag(gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          const moved = Math.abs(gesture.dy);
          setDrag(0);
          if (moved < 6) {
            setSnap((current) => (current === MIN_SNAP ? MAX_SNAP : MIN_SNAP));
            return;
          }
          const next = snap * visible - gesture.dy;
          if (next < visible * 0.4) {
            onCloseRef.current();
            return;
          }
          setSnap(next > visible * ((MIN_SNAP + MAX_SNAP) / 2) ? MAX_SNAP : MIN_SNAP);
        },
        onPanResponderTerminate: () => setDrag(0),
      }),
    [snap, visible],
  );

  if (!open) return null;

  const sheetHeight = Math.max(visible * 0.35, Math.min(visible * MAX_SNAP, snap * visible - drag));
  const body = (
    <>
      <View style={styles.header}>
        <View
          {...pan.panHandlers}
          accessible
          accessibilityRole="button"
          accessibilityLabel={title ?? '抽屉'}
          accessibilityState={{ expanded: snap === MAX_SNAP }}
          onAccessibilityTap={() => setSnap((current) => (current === MIN_SNAP ? MAX_SNAP : MIN_SNAP))}
          style={styles.handleHit}
          testID="drawer-handle"
        >
          <View style={styles.handle} />
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={onClose} style={({ pressed }) => [styles.close, pressed && styles.pressed]} testID="drawer-close">
          <Text style={styles.closeInk}>×</Text>
        </Pressable>
      </View>
      <View style={styles.content}>{children}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID={`${testID}-layer`}>
      <Pressable accessibilityLabel="关闭" onPress={onClose} style={styles.scrim} testID={`${testID}-scrim`} />
      {modal ? (
        <View style={styles.centered} pointerEvents="box-none">
          <View style={styles.modal} accessibilityViewIsModal testID={testID}>
            {body}
          </View>
        </View>
      ) : (
        <View style={[styles.sheet, { height: sheetHeight, bottom: inset }]} accessibilityViewIsModal testID={testID}>
          {body}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color.scrim },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: color.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.hairline,
    overflow: 'hidden',
  },
  centered: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: space[5] },
  modal: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '80%',
    backgroundColor: color.card,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: color.hairline,
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', paddingRight: space[2], gap: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.hairline },
  handleHit: { width: 64, height: 44, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: color.hairlineStrong },
  title: { ...type.heading, color: color.text, flex: 1 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  closeInk: { ...type.title, color: color.text2, lineHeight: 30 },
  pressed: { backgroundColor: color.press },
  content: { flex: 1, minHeight: 0 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline, padding: space[4], paddingBottom: space[4] },
});
