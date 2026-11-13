import { Send } from 'lucide-react-native';
import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StudioTurn } from '../../../src/studio/protocol';
import { hub } from '../lib/client';
import { kv } from '../lib/kv';
import { live } from '../lib/live';
import { aiName, defaultRoleNames, type RoleNames } from '../lib/roles';
import { session } from '../lib/session';
import { t, type Lang } from '../lib/strings';
import { randomOpId } from '../lib/submit';
import { color, radius, space, type } from '../lib/theme';
import { mergeTurns, type ChatTurn, type OptimisticTurn } from '../lib/turns';
import { useKeyboardInset } from '../lib/viewport';

interface PlanChatProps {
  readonly pid: string;
  readonly planRef: string;
  readonly turns: readonly StudioTurn[];
  readonly typing: boolean;
  readonly moreTurns: boolean;
  readonly lang: Lang;
  /** On desktop the chat is a fixed 360 panel; in a drawer it has no header of its own. */
  readonly docked?: boolean;
  readonly roleNames?: RoleNames;
}

interface PendingItem {
  readonly opId: string;
  readonly text: string;
  readonly at: number;
}

const pendingStorage = (pid: string, planRef: string): string => `pending:chat:${pid}:${planRef}`;
const draftStorage = (pid: string, planRef: string): string => `draft:chat:${pid}:${planRef}`;

const readPending = (pid: string, planRef: string): PendingItem[] => {
  const stored = kv.get<{ items?: PendingItem[] }>(pendingStorage(pid, planRef));
  return Array.isArray(stored?.items) ? stored.items : [];
};

const writePending = (pid: string, planRef: string, items: readonly PendingItem[]): void => {
  if (items.length) kv.set(pendingStorage(pid, planRef), { items, updatedAt: Date.now() });
  else kv.remove(pendingStorage(pid, planRef));
};

/**
 * The plan's conversation (M6 §4.9). One outbox list: every send has its own opId, a second can
 * go while the first is in flight, and a server turn with the same opId replaces its bubble. The
 * customer's messages are right; the studio's say "name · Studio"; the AI's use a role name.
 */
export function PlanChat({ pid, planRef, turns, typing, moreTurns, lang, docked = false, roleNames = defaultRoleNames }: PlanChatProps) {
  const [older, setOlder] = useState<StudioTurn[]>([]);
  const [olderMore, setOlderMore] = useState(false);
  const [optimistic, setOptimistic] = useState<OptimisticTurn[]>([]);
  const [text, setText] = useState(() => kv.get<{ text?: string }>(draftStorage(pid, planRef))?.text ?? '');
  const [atBottom, setAtBottom] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const contentHeight = useRef(0);
  const keepOffset = useRef<number | null>(null);
  const lastCount = useRef(0);
  const textRef = useRef(text);
  textRef.current = text;
  const optimisticRef = useRef(optimistic);
  optimisticRef.current = optimistic;
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restored = useRef(false);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();

  const merged = useMemo(() => mergeTurns(turns, older, optimistic), [turns, older, optimistic]);
  const canLoadOlder = olderMore || (moreTurns && older.length === 0);

  const scrollToEnd = (): void => {
    requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: false }));
  };

  // Restore unsent messages once; the hub's opId idempotency makes the retry safe.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const known = new Set(turns.flatMap((turn) => (turn.opId ? [turn.opId] : [])));
    const items = readPending(pid, planRef).filter((item) => !known.has(item.opId));
    if (items.length === 0) return;
    const restoredItems = items.map((item) => ({ ...item, state: 'queued' as const }));
    optimisticRef.current = restoredItems;
    setOptimistic(restoredItems);
    for (const item of items) void deliver(item.opId, item.text);
    // `deliver` is stable enough for this one-time restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, planRef]);

  // A server turn with our opId is the authoritative copy: drop the local bubble and its pending.
  useEffect(() => {
    const serverOps = new Set(turns.flatMap((turn) => (turn.opId ? [turn.opId] : [])));
    if (serverOps.size === 0) return;
    const remaining = optimisticRef.current.filter((item) => !serverOps.has(item.opId));
    optimisticRef.current = remaining;
    setOptimistic(remaining);
    const pending = readPending(pid, planRef).filter((item) => !serverOps.has(item.opId));
    writePending(pid, planRef, pending);
  }, [turns, pid, planRef]);

  // Live receipts settle a bubble before the daemon's next view.
  useEffect(() => {
    return live.subscribe(pid, {
      frame: (frame) => {
        if (frame.t !== 'receipt') return;
        const local = stateOf(frame.opId);
        if (!local) return;
        if (frame.state === 'done') {
          removePending(frame.opId);
          update(frame.opId, { state: 'queued' });
        } else if (frame.state === 'queued') {
          update(frame.opId, { state: 'queued' });
        } else if (frame.state === 'refused') {
          removePending(frame.opId);
          update(frame.opId, { state: 'failed', refused: true });
        } else {
          removePending(frame.opId);
          update(frame.opId, { state: 'failed', refused: true });
        }
      },
      state: () => {},
    });
  }, [pid]);

  useEffect(() => {
    scrollToEnd();
  }, [docked]);

  useEffect(() => {
    if (merged.length > lastCount.current) {
      if (atBottom) scrollToEnd();
      else setShowNew(true);
    }
    lastCount.current = merged.length;
  }, [merged.length, atBottom]);

  // The draft is written 300ms after the last keystroke and again when the page goes away.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flush = () => kv.set(draftStorage(pid, planRef), { text: textRef.current, updatedAt: Date.now() });
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', flush);
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [pid, planRef]);

  // Leaving the screen with unsent text keeps it for the next visit (no auto focus).
  useEffect(
    () => () => {
      const value = textRef.current;
      if (value.trim()) kv.set(draftStorage(pid, planRef), { text: value, updatedAt: Date.now() });
    },
    [pid, planRef],
  );

  function stateOf(opId: string): OptimisticTurn | undefined {
    return optimisticRef.current.find((item) => item.opId === opId);
  }

  function update(opId: string, patch: Partial<OptimisticTurn>): void {
    const next = optimisticRef.current.map((item) => (item.opId === opId ? { ...item, ...patch } : item));
    optimisticRef.current = next;
    setOptimistic(next);
  }

  function addOptimistic(item: OptimisticTurn): void {
    const next = [...optimisticRef.current, item];
    optimisticRef.current = next;
    setOptimistic(next);
  }

  function removePending(opId: string): void {
    writePending(
      pid,
      planRef,
      readPending(pid, planRef).filter((item) => item.opId !== opId),
    );
  }

  async function deliver(opId: string, value: string): Promise<void> {
    const answer = await hub.send(pid, { t: 'action', opId, kind: 'chat.send', planRef, payload: { text: value } });
    if (answer.ok) {
      if (answer.value.state === 'done') {
        removePending(opId);
        update(opId, { state: 'queued' });
      } else if (answer.value.state === 'queued') {
        update(opId, { state: 'queued' });
      } else {
        removePending(opId);
        update(opId, { state: 'failed', refused: true });
      }
      return;
    }
    if (answer.error.kind === 'signed-out') {
      session.clear();
      return;
    }
    update(opId, { state: 'failed' });
  }

  function send(): void {
    const value = textRef.current.trim();
    if (!value) return;
    const opId = randomOpId();
    const at = Date.now();
    // The ref is cleared in the same tick: a second click of a double tap sees an empty box and
    // cannot make a second action.
    textRef.current = '';
    setText('');
    kv.remove(draftStorage(pid, planRef));
    const item: PendingItem = { opId, text: value, at };
    writePending(pid, planRef, [...readPending(pid, planRef).filter((x) => x.opId !== opId), item]);
    addOptimistic({ ...item, state: 'sending' });
    setAtBottom(true);
    setShowNew(false);
    scrollToEnd();
    void deliver(opId, value);
  }

  function retry(opId: string): void {
    const local = stateOf(opId);
    if (!local || local.state === 'sending') return;
    if (local.refused) {
      // The hub's opId is terminal; a new try is a new action.
      removePending(opId);
      const remaining = optimisticRef.current.filter((item) => item.opId !== opId);
      optimisticRef.current = remaining;
      setOptimistic(remaining);
      const next = randomOpId();
      const item: PendingItem = { opId: next, text: local.text, at: local.at };
      writePending(pid, planRef, [...readPending(pid, planRef), item]);
      addOptimistic({ ...item, state: 'sending' });
      void deliver(next, local.text);
      return;
    }
    update(opId, { state: 'sending' });
    writePending(
      pid,
      planRef,
      [...readPending(pid, planRef).filter((item) => item.opId !== opId), { opId, text: local.text, at: local.at }],
    );
    void deliver(opId, local.text);
  }

  async function loadOlder(): Promise<void> {
    const before = older[0]?.id ?? turns[0]?.id;
    if (!before) return;
    const answer = await hub.turns(pid, planRef, before);
    if (!answer.ok) return;
    keepOffset.current = contentHeight.current;
    setOlder((prev) => [...answer.value.turns, ...prev]);
    setOlderMore(answer.value.more);
  }

  function changeText(value: string): void {
    textRef.current = value;
    setText(value);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => kv.set(draftStorage(pid, planRef), { text: value, updatedAt: Date.now() }), 300);
  }

  return (
    <View style={[styles.root, docked && styles.docked]}>
      {docked ? (
        <View style={styles.dockedHeader}>
          <Text style={styles.dockedTitle}>{t(lang, 'chat.title')}</Text>
        </View>
      ) : null}
      <View style={styles.listWrap}>
        <ScrollView
          ref={scroll}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            const bottom = contentSize.height - contentOffset.y - layoutMeasurement.height < 48;
            setAtBottom(bottom);
            if (bottom) setShowNew(false);
          }}
          onContentSizeChange={(_, height) => {
            const keep = keepOffset.current;
            contentHeight.current = height;
            if (keep !== null) {
              keepOffset.current = null;
              scroll.current?.scrollTo({ y: Math.max(0, height - keep), animated: false });
            } else if (atBottom) {
              scrollToEnd();
            }
          }}
          testID="chat-list"
        >
          {canLoadOlder ? (
            <Pressable accessibilityRole="button" onPress={() => void loadOlder()} style={styles.earlier} testID="chat-earlier">
              <Text style={styles.earlierText}>{t(lang, 'chat.earlier')}</Text>
            </Pressable>
          ) : null}
          {merged.map((turn) => (
            <Bubble key={turn.id} turn={turn} lang={lang} roleNames={roleNames} onRetry={retry} />
          ))}
          {typing ? (
            <View style={styles.typing} testID="chat-typing">
              <View style={styles.typingDot} />
              <Text style={styles.typingText}>{t(lang, 'chat.aiWriting')}</Text>
            </View>
          ) : null}
        </ScrollView>
        {showNew ? (
          <Pressable accessibilityRole="button" onPress={() => { setShowNew(false); scrollToEnd(); }} style={styles.newPill} testID="chat-new">
            <Text style={styles.newText}>{t(lang, 'chat.newMessages')}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.composer, { paddingBottom: keyboard > 0 ? 0 : insets.bottom }]}>
        <TextInput
          value={text}
          onChangeText={changeText}
          placeholder={t(lang, 'chat.saySomething')}
          placeholderTextColor={color.text3}
          multiline
          style={styles.input}
          testID="chat-input"
          accessibilityLabel={t(lang, 'chat.saySomething')}
          onFocus={() => setTimeout(scrollToEnd, 100)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(lang, 'chat.send')}
          accessibilityState={{ disabled: !text.trim() }}
          disabled={!text.trim()}
          onPress={send}
          style={({ pressed }) => [styles.send, !text.trim() && styles.sendOff, pressed && text.trim() ? styles.pressed : null]}
          testID="chat-send"
        >
          <Send size={18} color={text.trim() ? color.onPrimary : color.text3} />
        </Pressable>
      </View>
    </View>
  );
}

function Bubble({ turn, lang, roleNames, onRetry }: { readonly turn: ChatTurn; readonly lang: Lang; readonly roleNames: RoleNames; readonly onRetry: (opId: string) => void }) {
  if (turn.who === 'customer') {
    const status = turn.state === 'sending' ? t(lang, 'common.sending') : turn.state === 'queued' ? t(lang, 'chat.queued') : null;
    return (
      <View style={styles.mineRow}>
        <View style={styles.mineBubble}>
          <Text style={styles.mineText}>{turn.text}</Text>
        </View>
        {turn.state === 'failed' && turn.opId ? (
          <Pressable accessibilityRole="button" onPress={() => onRetry(turn.opId!)} style={styles.retry} testID={`chat-retry-${turn.opId}`}>
            <Text style={styles.retryText}>{t(lang, 'chat.failed')}</Text>
          </Pressable>
        ) : status ? (
          <Text style={styles.myStatus}>{status}</Text>
        ) : null}
      </View>
    );
  }
  const name =
    turn.who === 'studio'
      ? turn.name
        ? `${turn.name} · Studio`
        : 'Studio'
      : aiName(turn.role, roleNames);
  return (
    <View style={styles.theirRow}>
      <Text style={styles.theirName} numberOfLines={1}>
        {name}
      </Text>
      <View style={styles.theirBubble}>
        <Text style={styles.theirText}>{turn.text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: color.bg },
  docked: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: color.hairline },
  dockedHeader: { height: 44, paddingHorizontal: space[4], flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.hairline },
  dockedTitle: { ...type.heading, color: color.text },
  listWrap: { flex: 1, minHeight: 0 },
  list: { flex: 1 },
  listContent: { padding: space[4], gap: space[3], flexGrow: 1 },
  earlier: { alignSelf: 'center', minHeight: 44, paddingHorizontal: space[4], justifyContent: 'center', borderRadius: radius.pill, backgroundColor: color.sunken },
  earlierText: { ...type.caption, color: color.text2, fontWeight: '600' },
  mineRow: { alignSelf: 'flex-end', maxWidth: '84%', alignItems: 'flex-end', gap: 4 },
  mineBubble: { backgroundColor: color.primary, borderRadius: radius.l, paddingVertical: 10, paddingHorizontal: 12 },
  mineText: { ...type.callout, color: color.onPrimary },
  myStatus: { ...type.caption, color: color.text2 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  retryText: { ...type.caption, color: color.error, fontWeight: '600' },
  theirRow: { alignSelf: 'flex-start', maxWidth: '84%', gap: 4 },
  theirName: { ...type.caption, color: color.text2, fontWeight: '600' },
  theirBubble: { backgroundColor: color.card, borderRadius: radius.l, borderWidth: 1, borderColor: color.hairline, paddingVertical: 10, paddingHorizontal: 12 },
  theirText: { ...type.callout, color: color.text },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.ok },
  typingText: { ...type.caption, color: color.text2 },
  newPill: { position: 'absolute', bottom: space[3], alignSelf: 'center', minHeight: 44, paddingHorizontal: space[4], justifyContent: 'center', borderRadius: radius.pill, backgroundColor: color.card, borderWidth: 1, borderColor: color.hairlineStrong },
  newText: { ...type.caption, color: color.text, fontWeight: '600' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2], paddingHorizontal: space[3], paddingTop: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline, backgroundColor: color.bg },
  input: { ...type.callout, fontSize: 16, lineHeight: 22, flex: 1, minHeight: 44, maxHeight: 110, color: color.text, backgroundColor: color.card, borderWidth: 1, borderColor: color.hairline, borderRadius: radius.m, paddingHorizontal: 12, paddingVertical: 10 },
  send: { width: 44, height: 44, borderRadius: radius.m, backgroundColor: color.primary, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: '#E7E7EA' },
  pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
});
