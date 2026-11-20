import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AnimatedView,
  Gesture,
  GestureDetector,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from './drawer/motion';
import { detectLang, type Lang } from '../lib/strings';
import { tDrawer } from '../lib/strings/drawer';
import { acquireDrawer } from '../lib/ui-state';
import { color, radius, space, type } from '../lib/theme';
import { useKeyboardInset } from '../lib/viewport';
import { Segments } from './Segments';

export interface DrawerTab {
  readonly key: string;
  readonly label: string;
  readonly render: () => ReactNode;
}

export interface DrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title?: string;
  readonly lang?: Lang;
  readonly tabs?: readonly DrawerTab[];
  readonly initialTab?: string;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly testID?: string;
  /** 手机用底部抽屉，桌面端用居中弹层。 */
  readonly variant?: 'sheet' | 'modal';
  readonly initialSnap?: 0.55 | 0.8;
}

const DISMISS_RATIO = 0.3;
const DISMISS_VELOCITY = 900;

/** 手势关闭判定：拖过三成或向下甩得够快即关闭。 */
export function shouldDismissDrawer(translationY: number, velocityY: number, sheetHeight: number): boolean {
  if (translationY <= 0) return false;
  return translationY > sheetHeight * DISMISS_RATIO || velocityY > DISMISS_VELOCITY;
}

/**
 * P12 结果抽屉外壳（SS-47）：
 * - gesture-handler + reanimated：下拉跟手、拖过三成或甩得够快关闭、点遮罩关闭；
 * - 系统减弱动态效果时直接到位；
 * - 内容超高在抽屉内滚动；
 * - 顶部页签由调用方传入 `tabs: {key,label,render}[]`，不耦合任何页签内容；
 * - 打开时通过 `acquireDrawer()` 设置 `ui-state.drawerOpen`。
 */
export function Drawer({
  open,
  onClose,
  title,
  lang: langProp,
  tabs,
  initialTab,
  children,
  footer,
  testID = 'drawer',
  variant = 'sheet',
  initialSnap = 0.8,
}: DrawerProps) {
  const { width, height } = useWindowDimensions();
  const lang = langProp ?? detectLang();
  const inset = useKeyboardInset();
  const safeBottom = useSafeAreaInsets().bottom;
  const reducedMotion = useReducedMotion();
  const modal = variant === 'modal' || width >= 900;
  const visible = Math.max(280, height - inset);
  const sheetHeight = Math.round(visible * initialSnap);

  const [activeTab, setActiveTab] = useState<string>(() => initialTab ?? tabs?.[0]?.key ?? '');
  const translateY = useSharedValue(sheetHeight);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!tabs || tabs.length === 0) return;
    if (initialTab && tabs.some((tab) => tab.key === initialTab)) {
      setActiveTab(initialTab);
    } else if (!tabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(tabs[0]!.key);
    }
  }, [tabs, initialTab, activeTab]);

  useEffect(() => {
    if (!open) return;
    return acquireDrawer();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (reducedMotion) {
      translateY.value = 0;
    } else {
      translateY.value = sheetHeight;
      translateY.value = withSpring(0, { damping: 24, stiffness: 260 });
    }
  }, [open, reducedMotion, sheetHeight, translateY]);

  const closeWithMotion = () => {
    if (reducedMotion) {
      onCloseRef.current();
      return;
    }
    translateY.value = withTiming(sheetHeight, { duration: 160 }, (finished) => {
      if (finished) runOnJS(onCloseRef.current)();
    });
  };

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((e) => {
          translateY.value = Math.max(0, e.translationY);
        })
        .onEnd((e) => {
          if (shouldDismissDrawer(e.translationY, e.velocityY, sheetHeight)) {
            if (reducedMotion) {
              runOnJS(onCloseRef.current)();
            } else {
              translateY.value = withTiming(sheetHeight, { duration: 150 }, (finished) => {
                if (finished) runOnJS(onCloseRef.current)();
              });
            }
          } else {
            translateY.value = reducedMotion ? 0 : withSpring(0, { damping: 24, stiffness: 260 });
          }
        }),
    [reducedMotion, sheetHeight, translateY],
  );

  const animatedSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!open) return null;

  const currentTab = tabs?.find((tab) => tab.key === activeTab) ?? tabs?.[0];
  const segmentItems = tabs?.map((tab) => ({
    key: tab.key,
    label: tab.label,
    testID: `${testID}-tab-${tab.key}`,
  }));

  const body = (
    <>
      <GestureDetector gesture={panGesture}>
        <View style={styles.header} testID={`${testID}-header`}>
          <View style={styles.handleHit} hitSlop={{ top: 12, bottom: 12 }} testID="drawer-handle">
            <View style={[styles.handle, { backgroundColor: color.hairlineStrong }]} />
          </View>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: color.text }]} numberOfLines={1}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tDrawer(lang, 'drawer.close')}
              onPress={closeWithMotion}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              testID="drawer-close"
            >
              <Text style={[styles.closeInk, { color: color.text2 }]}>×</Text>
            </Pressable>
          </View>
        </View>
      </GestureDetector>

      {segmentItems && segmentItems.length > 0 ? (
        <Segments items={segmentItems} value={currentTab?.key ?? ''} onChange={setActiveTab} />
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        testID={`${testID}-scroll`}
      >
        {currentTab ? currentTab.render() : children}
      </ScrollView>

      {footer ? (
        <View
          style={[
            styles.footer,
            {
              borderTopColor: color.hairline,
              paddingBottom: inset > 0 ? space[3] : safeBottom + space[3],
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID={`${testID}-layer`}>
      <Pressable
        accessibilityLabel={tDrawer(lang, 'drawer.close')}
        onPress={closeWithMotion}
        style={[styles.scrim, { backgroundColor: color.scrim }]}
        testID={`${testID}-scrim`}
      />
      {modal ? (
        <View style={styles.centered} pointerEvents="box-none">
          <View
            style={[styles.modal, { backgroundColor: color.card }]}
            accessibilityViewIsModal
            role="dialog"
            testID={testID}
          >
            {body}
          </View>
        </View>
      ) : (
        <AnimatedView
          style={[
            styles.sheet,
            { height: sheetHeight, bottom: inset, backgroundColor: color.card },
            animatedSheetStyle,
          ]}
          accessibilityViewIsModal
          role="dialog"
          testID={testID}
        >
          {body}
        </AnimatedView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill },
  centered: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: space[5] },
  modal: { width: '100%', maxWidth: 560, maxHeight: '85%', borderRadius: radius.l, overflow: 'hidden' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopLeftRadius: radius.l,
    borderTopRightRadius: radius.l,
    overflow: 'hidden',
  },
  header: {
    paddingTop: space[2],
    paddingHorizontal: space[4],
    paddingBottom: space[2],
    gap: space[1],
  },
  handleHit: { height: 20, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 36, height: 4, borderRadius: 2 },
  titleRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...type.heading, flex: 1 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -space[2] },
  closeInk: { fontSize: 22, lineHeight: 24 },
  pressed: { opacity: 0.55 },
  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { padding: space[4], flexGrow: 1 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space[4],
    paddingTop: space[3],
  },
});
