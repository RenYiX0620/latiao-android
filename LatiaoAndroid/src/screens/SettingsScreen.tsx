import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import {
  clearHistory,
  DEFAULT_PREFS,
  loadPrefs,
  savePrefs,
  type Prefs,
} from '../store/prefs';

/**
 * 设置页：模型参数 + 系统提示词 + 清空历史。
 * 改动点「保存」才落盘；加载模型时才会应用 nGpuLayers/nCtx。
 */

type Props = {
  onSaved?: (p: Prefs) => void;
};

export default function SettingsScreen({ onSaved }: Props) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    loadPrefs().then(p => setPrefs(p));
  }, []);

  const patch = (p: Partial<Prefs>) => {
    setPrefs(s => ({ ...s, ...p }));
    setDirty(true);
  };

  const save = async () => {
    await savePrefs(prefs);
    setDirty(false);
    setToast('已保存');
    onSaved?.(prefs);
    setTimeout(() => setToast(''), 1500);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.hint}>参数改动点保存；GPU 层/上下文在下次「加载模型」时生效</Text>

      <Text style={styles.label}>Temperature（0–2，越高越发散）</Text>
      <TextInput
        style={styles.input}
        keyboardType="decimal-pad"
        value={String(prefs.temperature)}
        onChangeText={v => patch({ temperature: Math.min(2, Math.max(0, Number(v) || 0)) })}
      />

      <Text style={styles.label}>GPU offload 层数（0 = 纯 CPU；手机常见 4–12）</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={String(prefs.nGpuLayers)}
        onChangeText={v => patch({ nGpuLayers: Math.max(0, Number(v) || 0) })}
      />

      <Text style={styles.label}>上下文长度 n_ctx（改后需重载模型）</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={String(prefs.nCtx)}
        onChangeText={v => patch({ nCtx: Math.min(32768, Math.max(512, Number(v) || 4096)) })}
      />

      <Text style={styles.label}>系统提示词（每轮对话追加）</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        multiline
        value={prefs.systemPrompt}
        onChangeText={v => patch({ systemPrompt: v })}
      />

      <Pressable
        style={[styles.btn, !dirty && styles.btnDisabled]}
        onPress={save}
        disabled={!dirty}
      >
        <Text style={styles.btnText}>{dirty ? '保存设置' : '已保存'}</Text>
      </Pressable>
      {toast ? <Text style={styles.toast}>{toast}</Text> : null}

      <Pressable
        style={[styles.btn, styles.btnDanger]}
        onPress={async () => {
          await clearHistory();
          setToast('对话历史已清空');
          setTimeout(() => setToast(''), 1500);
        }}
      >
        <Text style={styles.btnText}>清空对话历史</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e0e10' },
  hint: { color: '#777', fontSize: 12, marginBottom: 16 },
  label: { color: '#8ab4af', fontSize: 13, marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: '#1c1c1f',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#eee',
    fontSize: 15,
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  btn: {
    marginTop: 20,
    backgroundColor: '#2f6f6a',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.45 },
  btnDanger: { backgroundColor: '#5a2d2d', marginTop: 12 },
  btnText: { color: '#fff', fontWeight: '600' },
  toast: { color: '#8ab4af', textAlign: 'center', marginTop: 10, fontSize: 13 },
});
