import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { runAgentLoop, type AgentMsg } from '../agent/loop';
import { getContext, isLoaded, loadModel } from '../llama/engine';
import {
  loadPrefs,
  loadSessions,
  saveSessions,
  type Prefs,
  type Session,
} from '../store/prefs';

/**
 * 对话页（对标 PocketPal）：
 * - 空状态引导：吉祥物 + 步骤 + 「选择模型」大按钮
 * - 模型未加载：输入框禁用并说明原因
 * - 左上角 ☰ 开抽屉（导航/历史）
 * - 会话落盘：sessions.json，可新建/切换
 */

type UiMsg = { id: string; role: 'user' | 'assistant'; content: string; streaming?: boolean };

export type ChatScreenProps = {
  modelPath: string;
  onPickModels: () => void;
  onOpenDrawer: () => void;
  prefsVersion?: number;
  activeSession: Session | null;
  onSessionChange: (s: Session) => void;
};

function askConfirmNative(toolName: string, args: Record<string, unknown>): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(
      `允许「${toolName}」？`,
      JSON.stringify(args, null, 2),
      [
        { text: '拒绝', style: 'cancel', onPress: () => resolve(false) },
        { text: '允许', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });
}

function toUi(msgs: Session['messages']): UiMsg[] {
  return msgs.map((m, i) => ({
    id: `h-${i}-${m.ts ?? 0}-${m.role}`,
    role: m.role,
    content: m.content,
  }));
}

export default function ChatScreen({
  modelPath,
  onPickModels,
  onOpenDrawer,
  prefsVersion = 0,
  activeSession,
  onSessionChange,
}: ChatScreenProps) {
  const [loading, setLoading] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [status, setStatus] = useState('');
  const prefsRef = useRef<Prefs | null>(null);
  const listRef = useRef<FlatList>(null);
  const busyRef = useRef(false);
  const loadedRef = useRef(false);

  // 切换会话 / 设置变更 → 载入消息
  useEffect(() => {
    setMessages(toUi(activeSession?.messages ?? []));
  }, [activeSession?.id, prefsVersion]);

  useEffect(() => {
    loadPrefs().then(p => {
      prefsRef.current = p;
    });
  }, [prefsVersion]);

  /** 持久化当前会话（合并进 sessions.json） */
  const persist = useCallback(
    (list: UiMsg[]) => {
      if (!activeSession) {
        return;
      }
      const clean = list
        .filter(m => !m.streaming && m.content)
        .map(m => ({ role: m.role, content: m.content, ts: Date.now() }));
      const updated: Session = {
        ...activeSession,
        messages: clean,
        ts: Date.now(),
        title:
          activeSession.title && activeSession.title !== '新对话'
            ? activeSession.title
            : (clean.find(m => m.role === 'user')?.content || '新对话').slice(0, 24),
      };
      onSessionChange(updated);
      loadSessions()
        .then(f => {
          const idx = f.sessions.findIndex(s => s.id === updated.id);
          const sessions =
            idx >= 0
              ? f.sessions.map(s => (s.id === updated.id ? updated : s))
              : [updated, ...f.sessions];
          return saveSessions({
            sessions,
            activeId: updated.id,
          });
        })
        .catch(() => undefined);
    },
    [activeSession, onSessionChange],
  );

  const onLoad = useCallback(async () => {
    if (!modelPath || loading) {
      return;
    }
    setLoading(true);
    setLoadPct(0);
    try {
      const prefs = prefsRef.current ?? (await loadPrefs());
      prefsRef.current = prefs;
      await loadModel(modelPath, p => setLoadPct(Math.round(p * 100)), {
        nCtx: prefs.nCtx,
        nGpuLayers: prefs.nGpuLayers,
      });
      loadedRef.current = true;
      setStatus('模型已加载');
    } catch (e) {
      loadedRef.current = false;
      setStatus(`加载失败：${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [modelPath, loading]);

  const modelReady = loadedRef.current || isLoaded();

  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text || busyRef.current || !modelReady) {
      return;
    }
    setInput('');
    busyRef.current = true;
    setStatus('');
    const userMsg: UiMsg = { id: `u-${Date.now()}`, role: 'user', content: text };
    const assistantId = `a-${Date.now()}`;
    setMessages(m => [...m, userMsg, { id: assistantId, role: 'assistant', content: '', streaming: true }]);

    const prefs = prefsRef.current ?? (await loadPrefs());
    const history: AgentMsg[] = [
      { role: 'system', content: prefs.systemPrompt },
      ...[...messages, userMsg].map(m => ({ role: m.role, content: m.content }) as AgentMsg),
    ];

    let acc = '';
    try {
      const ctx = getContext();
      if (!ctx) {
        throw new Error('模型未加载');
      }
      const full = await runAgentLoop(ctx, history, {
        temperature: prefs.temperature,
        onAssistantText: tok => {
          acc += tok;
          setMessages(m => m.map(x => (x.id === assistantId ? { ...x, content: acc } : x)));
        },
        onToolStart: name => setStatus(`⚙️ 调用 ${name}…`),
        onToolEnd: name => setStatus(`✓ ${name}`),
        askConfirm: askConfirmNative,
        log: l => console.log(`[agent] ${l}`),
      });
      const out = full || acc;
      setMessages(m => {
        const updated = m.map(x =>
          x.id === assistantId ? { ...x, content: out, streaming: false } : x,
        );
        persist(updated);
        return updated;
      });
      setStatus('');
    } catch (e) {
      setMessages(m => {
        const updated = m.map(x =>
          x.id === assistantId
            ? { ...x, content: `出错了：${String(e)}`, streaming: false }
            : x,
        );
        persist(updated);
        return updated;
      });
      setStatus('');
    } finally {
      busyRef.current = false;
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [input, messages, modelReady, persist]);

  const shortPath = modelPath ? modelPath.split('/').pop() : '';
  const showGuide = !modelReady;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable style={styles.iconBtn} onPress={onOpenDrawer} hitSlop={8}>
          <Text style={styles.iconText}>☰</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {activeSession?.title && activeSession.title !== '新对话'
            ? activeSession.title
            : '聊天'}
        </Text>
        <View style={styles.headerRight}>
          {modelReady ? (
            <Pressable style={styles.chip} onPress={onPickModels}>
              <Text style={styles.chipText} numberOfLines={1}>
                {shortPath || '模型'}
              </Text>
            </Pressable>
          ) : (
            <Pressable style={styles.loadBtnSmall} onPress={onPickModels}>
              <Text style={styles.btnText}>选模型</Text>
            </Pressable>
          )}
        </View>
      </View>
      {(loading || status) && (
        <Text style={styles.status}>{loading ? `加载中 ${loadPct}%` : status}</Text>
      )}

      {showGuide && messages.length === 0 ? (
        <View style={styles.guide}>
          <Text style={styles.mascot}>🛸</Text>
          <Text style={styles.guideTitle}>在您开始聊天前，请先激活模型</Text>
          <Text style={styles.guideBody}>
            选择模型并下载。下载完成后，点击模型旁边的「加载」按钮，即可开始聊天。
          </Text>
          <Pressable style={styles.ctaBtn} onPress={onPickModels}>
            <Text style={styles.ctaText}>选择模型</Text>
          </Pressable>
          {modelPath ? (
            <Pressable style={[styles.ctaBtn, styles.ctaSecondary]} onPress={onLoad}>
              {loading ? (
                <ActivityIndicator color="#111" size="small" />
              ) : (
                <Text style={[styles.ctaText, { color: '#111' }]}>
                  加载已下载的模型
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.list}
          data={messages}
          keyExtractor={m => m.id}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View
              style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.botBubble]}
            >
              <Text style={styles.bubbleText}>
                {item.content}
                {item.streaming ? ' ▌' : ''}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>问点什么，或让它用工具干活</Text>
          }
        />
      )}

      <View style={styles.inputBar}>
        <TextInput
          style={[styles.input, !modelReady && styles.inputDisabled]}
          placeholder={
            modelReady ? '说点什么…' : '模型未加载，请初始化模型。'
          }
          placeholderTextColor="#888"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={onSend}
          editable={modelReady}
          multiline
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || !modelReady) && styles.btnDisabled]}
          onPress={onSend}
          disabled={!input.trim() || !modelReady}
        >
          <Text style={styles.btnText}>发</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e0e10' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 6,
  },
  iconBtn: { padding: 8 },
  iconText: { color: '#eee', fontSize: 20 },
  headerTitle: { flex: 1, color: '#eee', fontSize: 16, fontWeight: '600' },
  headerRight: { maxWidth: '42%' },
  chip: {
    backgroundColor: '#1c1c1f',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { color: '#8ab4af', fontSize: 11 },
  loadBtnSmall: {
    backgroundColor: '#2f6f6a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  btnDisabled: { opacity: 0.4 },
  status: { color: '#8ab4af', paddingHorizontal: 16, paddingBottom: 6, fontSize: 12 },
  guide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  mascot: { fontSize: 72, marginBottom: 18 },
  guideTitle: {
    color: '#eee',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
  },
  guideBody: {
    color: '#999',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 28,
  },
  ctaBtn: {
    backgroundColor: '#d8d8d8',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginBottom: 12,
    minWidth: 220,
    alignItems: 'center',
  },
  ctaSecondary: { backgroundColor: '#2f6f6a' },
  ctaText: { color: '#111', fontSize: 15, fontWeight: '600' },
  list: { flex: 1, paddingHorizontal: 10 },
  empty: { color: '#666', textAlign: 'center', marginTop: 48 },
  bubble: { maxWidth: '88%', borderRadius: 12, padding: 12, marginVertical: 4 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#2f6f6a' },
  botBubble: { alignSelf: 'flex-start', backgroundColor: '#1c1c1f' },
  bubbleText: { color: '#eee', fontSize: 15, lineHeight: 21 },
  inputBar: {
    flexDirection: 'row',
    padding: 10,
    gap: 8,
    alignItems: 'flex-end',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2a2d',
    backgroundColor: '#141416',
  },
  input: {
    flex: 1,
    backgroundColor: '#1c1c1f',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#eee',
    fontSize: 15,
    maxHeight: 100,
  },
  inputDisabled: { opacity: 0.55 },
  sendBtn: {
    backgroundColor: '#2f6f6a',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
