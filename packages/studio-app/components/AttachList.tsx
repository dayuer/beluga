import { Camera, Image as ImageIcon, X } from 'lucide-react-native';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useScheme } from '../lib/appearance';
import type { MediaAttachment } from '../lib/media';
import type { Lang } from '../lib/strings';
import { tMedia } from '../lib/strings/media';
import { color, radius, space, type } from '../lib/theme';
import { undoStore } from '../lib/undo';

export interface AttachListProps {
  readonly items: readonly MediaAttachment[];
  readonly onAddCamera: () => void;
  readonly onAddLibrary: () => void;
  readonly onRemove: (id: string) => void;
  readonly onRestore: (item: MediaAttachment, index: number) => void;
  readonly permissionHint?: string | null;
  readonly lang: Lang;
  readonly disabled?: boolean;
}

/**
 * 附件清单（SS-40 / SS-199）：拍照 / 选图按钮与移除按钮均满足 ≥ 44pt 点击区，
 * 文案来自 lib/strings/media.ts，移除给 4 秒撤销（undoStore）。
 */
export function AttachList({
  items,
  onAddCamera,
  onAddLibrary,
  onRemove,
  onRestore,
  permissionHint,
  lang,
  disabled = false,
}: AttachListProps) {
  useScheme();
  const styles = createStyles();
  const handleRemove = (item: MediaAttachment, index: number) => {
    onRemove(item.id);
    const label = item.fileName
      ? tMedia(lang, 'media.removedNamed', { name: item.fileName })
      : tMedia(lang, 'media.removedUnnamed');
    undoStore.show({
      text: label,
      ms: 4000,
      fire: () => {},
      onUndo: () => onRestore(item, index),
    });
  };

  return (
    <View style={styles.wrap} testID="attach-list">
      <View style={styles.buttons}>
        <Pressable
          onPress={onAddCamera}
          disabled={disabled}
          accessibilityRole="button"
          testID="attach-camera"
          style={({ pressed }) => [styles.btn, disabled && styles.disabled, pressed && styles.pressed]}
        >
          <Camera size={15} color={color.text2} />
          <Text style={styles.btnText}>{tMedia(lang, 'media.camera')}</Text>
        </Pressable>

        <Pressable
          onPress={onAddLibrary}
          disabled={disabled}
          accessibilityRole="button"
          testID="attach-library"
          style={({ pressed }) => [styles.btn, disabled && styles.disabled, pressed && styles.pressed]}
        >
          <ImageIcon size={15} color={color.text2} />
          <Text style={styles.btnText}>{tMedia(lang, 'media.library')}</Text>
        </Pressable>
      </View>

      {permissionHint ? (
        <View
          style={styles.hintBox}
          accessibilityLiveRegion="polite"
          testID="attach-permission-hint"
        >
          <Text style={styles.hintText}>{permissionHint}</Text>
        </View>
      ) : null}

      {items.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbRow}
          testID="attach-thumbs"
        >
          {items.map((item, idx) => (
            <View key={item.id} style={styles.thumbWrap} testID={`attach-item-${item.id}`}>
              <Image source={{ uri: item.uri }} style={styles.thumb} resizeMode="cover" />
              <Pressable
                onPress={() => handleRemove(item, idx)}
                disabled={disabled}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={tMedia(lang, 'media.removeLabel')}
                testID={`attach-remove-${item.id}`}
                style={styles.removeBtn}
              >
                <X size={12} color={color.card} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const createStyles = () => StyleSheet.create({
  wrap: { marginTop: space[3], gap: space[2] },
  buttons: { flexDirection: 'row', gap: space[2] },
  btn: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space[3],
    borderRadius: radius.s,
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pressed: { backgroundColor: color.press },
  disabled: { opacity: 0.45 },
  btnText: { ...type.caption, fontWeight: '500', color: color.text2 },
  hintBox: {
    backgroundColor: color.sunken,
    borderRadius: radius.s,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  hintText: { ...type.caption, color: color.error },
  thumbRow: { gap: space[2], paddingTop: space[1] },
  thumbWrap: {
    width: 68,
    height: 68,
    borderRadius: radius.s,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.hairline,
    backgroundColor: color.sunken,
  },
  thumb: { width: '100%', height: '100%' },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(29,29,31,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
