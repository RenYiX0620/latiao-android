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
import { loadHistory, loadPrefs, saveHistory, type Prefs } from '../store/prefs';

/**
 * 对话页：模型加载 + agent 循环。
 * 历史/偏好持久化到 App 沙箱 JSON —— 杀 App 重开不丢（对齐 PocketPal「历史搜索」的第一步）。
 */

type UiMsg = { id: string; role: 'user' | 'assistant'; content: string; streaming?: boolean };

export type ChatScreenProps = {
  modelPath: string;
  onPickModels: () => void;
  /** 设置页保存后递增 → 重读 prefs/历史 */
  prefsVersion?: number;
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

export default function ChatScreen({
  modelPath,
  onPickModels,
  prefsVersion = 0,
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

  useEffect(() => {
    let alive = true;
    (async () => {
      const [hist, prefs] = await Promise.all([loadHistory(), loadPrefs()]);
      if (!alive) {
        return;
      }
      prefsRef.current = prefs;
      setMessages(
        hist.map((m, i) => ({
          id: `h-${i}-${m.ts ?? 0}-${m.role}`,
          role: m.role,
          content: m.content,
        })),
      );
    })();
    return () => {
      alive = false;
    };
  }, [prefsVersion]);

  const persist = useCallback((list: UiMsg[]) => {
    const clean = list
      .filter(m => !m.streaming && m.content)
      .map(m => ({ role: m.role, content: m.content, ts: Date.now() }));
    saveHistory(clean).catch(() => undefined);
  }, []);

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

  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text || busyRef.current) {
      return;
    }
    if (!loadedRef.current && !isLoaded()) {
      setStatus('先加载模型（可到「模型」页下载并选用）');
      return;
    }
    setInput('');
    busyRef.current = true;
    setStatus('');
    const userMsg: UiMsg = { id: `u-${Date.now()}`, role: 'user', content: text };
    const assistantId = `a-${Date.now()}`;
    setMessages(m => [
      ...m,
      userMsg,
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ]);

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
          setMessages(m =>
            m.map(x => (x.id === assistantId ? { ...x, content: acc } : x)),
          );
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
  }, [input, messages, persist]);

  const shortPath = modelPath ? modelPath.split('/').pop() : '未选模型';

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Pressable style={styles.modelBar} onPress={onPickModels}>
        <Text style={styles.modelLabel}>模型：</Text>
        <Text style={styles.modelName} numberOfLines={1}>
          {shortPath}
        </Text>
        <Pressable
          style={[styles.loadBtn, (loading || !modelPath) && styles.btnDisabled]}
          onPress={onLoad}
          disabled={loading || !modelPath}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnText}>加载</Text>
          )}
        </Pressable>
      </Pressable>
      {(loading || status) && (
        <Text style={styles.status}>{loading ? `加载中 ${loadPct}%` : status}</Text>
      )}

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
        ListEmptyComponent={<Text style={styles.empty}>问点什么，或让它用工具干活</Text>}
      />

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="说点什么…"
          placeholderTextColor="#888"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={onSend}
          multiline
        />
        <Pressable style={[styles.sendBtn, !input.trim() && styles.btnDisabled]} onPress={onSend}>
          <Text style={styles.btnText}>发</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e0e10' },
  modelBar: { flexDirection: 'row', padding: 10, gap: 8, alignItems: 'center' },
  modelLabel: { color: '#888', fontSize: 13 },
  modelName: { flex: 1, color: '#8ab4af', fontSize: 13 },
  loadBtn: {
    backgroundColor: '#2f6f6a',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 64,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '600' },
  status: { color: '#8ab4af', paddingHorizontal: 12, paddingBottom: 6, fontSize: 12 },
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
  },
  input: {
    flex: 1,
    backgroundColor: '#1c1c1f',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#eee',
    fontSize: 15,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: '#2f6f6a',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
  },
});
