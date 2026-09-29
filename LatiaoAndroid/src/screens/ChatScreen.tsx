import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { chatStream, isLoaded, loadModel, type ChatMsg } from '../llama/engine';

/**
 * POC 对话页：模型路径 + 流式聊天。
 * 验证点：initLlama 能加载、completion 能流式吐字。
 */

type UiMsg = ChatMsg & { id: string; streaming?: boolean };

export default function ChatScreen() {
  const [modelPath, setModelPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const listRef = useRef<FlatList>(null);
  const loadingRef = useRef(false);

  const onLoad = useCallback(async () => {
    if (!modelPath.trim() || loading) {
      return;
    }
    setLoading(true);
    setLoadPct(0);
    try {
      await loadModel(modelPath.trim(), p => setLoadPct(Math.round(p * 100)));
    } catch (e) {
      setMessages(m => [
        ...m,
        { id: `e-${Date.now()}`, role: 'assistant', content: `加载失败：${String(e)}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [modelPath, loading]);

  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loadingRef.current) {
      return;
    }
    if (!isLoaded()) {
      setMessages(m => [
        ...m,
        { id: `e-${Date.now()}`, role: 'assistant', content: '先在上方填入 .gguf 路径并加载模型' },
      ]);
      return;
    }
    setInput('');
    loadingRef.current = true;
    const userMsg: UiMsg = { id: `u-${Date.now()}`, role: 'user', content: text };
    const assistantId = `a-${Date.now()}`;
    const history = [...messages, userMsg];
    setMessages([...history, { id: assistantId, role: 'assistant', content: '', streaming: true }]);
    try {
      const full = await chatStream(
        history.map(({ role, content }) => ({ role, content })),
        data => {
          if (data?.token) {
            setMessages(m =>
              m.map(x => (x.id === assistantId ? { ...x, content: x.content + data.token } : x)),
            );
          }
        },
      );
      setMessages(m =>
        m.map(x => (x.id === assistantId ? { ...x, content: full, streaming: false } : x)),
      );
    } catch (e) {
      setMessages(m =>
        m.map(x =>
          x.id === assistantId
            ? { ...x, content: `对话失败：${String(e)}`, streaming: false }
            : x,
        ),
      );
    } finally {
      loadingRef.current = false;
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [input, messages]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.modelBar}>
        <TextInput
          style={styles.modelInput}
          placeholder="GGUF 模型绝对路径（如 …/models/qwen2.5-1.5b-instruct-q4_k_m.gguf）"
          placeholderTextColor="#888"
          value={modelPath}
          onChangeText={setModelPath}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          style={[styles.loadBtn, (loading || !modelPath.trim()) && styles.btnDisabled]}
          onPress={onLoad}
          disabled={loading || !modelPath.trim()}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnText}>{isLoaded() ? '重载' : '加载'}</Text>
          )}
        </Pressable>
      </View>
      {loading && <Text style={styles.progress}>加载中 {loadPct}%</Text>}

      <FlatList
        ref={listRef}
        style={styles.list}
        data={messages}
        keyExtractor={m => m.id}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === 'user' ? styles.userBubble : styles.botBubble,
            ]}
          >
            <Text style={styles.bubbleText}>
              {item.content}
              {item.streaming ? ' ▌' : ''}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>输入 GGUF 路径加载模型，开始本地对话</Text>
        }
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
  modelInput: {
    flex: 1,
    backgroundColor: '#1c1c1f',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#eee',
    fontSize: 13,
  },
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
  progress: { color: '#8ab4af', paddingHorizontal: 12, paddingBottom: 6, fontSize: 12 },
  list: { flex: 1, paddingHorizontal: 10 },
  empty: { color: '#666', textAlign: 'center', marginTop: 48 },
  bubble: {
    maxWidth: '88%',
    borderRadius: 12,
    padding: 12,
    marginVertical: 4,
  },
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
