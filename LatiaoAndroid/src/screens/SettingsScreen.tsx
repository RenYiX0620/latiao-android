import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  clearHistory,
  DEFAULT_PREFS_EXT,
  loadPrefsExt,
  savePrefsExt,
  type Pal,
  type PrefsExt,
} from '../store/prefs';

/**
 * 设置：模型参数 + 联网搜索 Key + Pals 人设 + 清历史。
 */

type Props = {
  onSaved?: (p: PrefsExt) => void;
  onOpenDrawer?: () => void;
};

export default function SettingsScreen({ onSaved, onOpenDrawer }: Props) {
  const [prefs, setPrefs] = useState<PrefsExt>(DEFAULT_PREFS_EXT);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState('');
  const [palName, setPalName] = useState('');
  const [palPrompt, setPalPrompt] = useState('');

  useEffect(() => {
    loadPrefsExt().then(p => setPrefs(p));
  }, []);

  const patch = (p: Partial<PrefsExt>) => {
    setPrefs(s => ({ ...s, ...p }));
    setDirty(true);
  };

  const save = async () => {
    await savePrefsExt(prefs);
    setDirty(false);
    setToast('已保存');
    onSaved?.(prefs);
    setTimeout(() => setToast(''), 1500);
  };

  const addPal = () => {
    if (!palName.trim()) {
      return;
    }
    const pal: Pal = {
      id: `pal-${Date.now()}`,
      name: palName.trim(),
      systemPrompt: palPrompt.trim() || prefs.systemPrompt,
    };
    patch({ pals: [...prefs.pals, pal], activePalId: pal.id });
    setPalName('');
    setPalPrompt('');
  };

  return (
    <>
      <View style={styles.header}>
        <Pressable style={styles.iconBtn} onPress={onOpenDrawer} hitSlop={8}>
          <Text style={styles.iconText}>☰</Text>
        </Pressable>
        <Text style={styles.headerTitle}>设置</Text>
      </View>
      <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Text style={styles.hint}>参数改动点保存；GPU/线程/上下文在下次「加载模型」时生效</Text>

        <Text style={styles.label}>Temperature（0–2）</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={String(prefs.temperature)}
          onChangeText={v => patch({ temperature: Math.min(2, Math.max(0, Number(v) || 0)) })}
        />

        <Text style={styles.label}>GPU offload 层数（0 = 纯 CPU）</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={String(prefs.nGpuLayers)}
          onChangeText={v => patch({ nGpuLayers: Math.max(0, Number(v) || 0) })}
        />

        <Text style={styles.label}>CPU 线程数 n_threads（一般 2–8）</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={String(prefs.nThreads)}
          onChangeText={v => patch({ nThreads: Math.min(32, Math.max(1, Number(v) || 2)) })}
        />

        <Text style={styles.label}>上下文长度 n_ctx</Text>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          value={String(prefs.nCtx)}
          onChangeText={v => patch({ nCtx: Math.min(32768, Math.max(512, Number(v) || 4096)) })}
        />

        <Text style={styles.label}>默认系统提示词</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          multiline
          value={prefs.systemPrompt}
          onChangeText={v => patch({ systemPrompt: v })}
        />

        <Text style={styles.sectionTitle}>联网搜索（可选）</Text>
        <View style={styles.rowBtns}>
          {(
            [
              ['none', '关闭'],
              ['tavily', 'Tavily'],
              ['brave', 'Brave'],
            ] as const
          ).map(([k, label]) => (
            <Pressable
              key={k}
              style={[styles.segBtn, prefs.searchProvider === k && styles.segActive]}
              onPress={() => patch({ searchProvider: k })}
            >
              <Text style={styles.segText}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {prefs.searchProvider !== 'none' && (
          <TextInput
            style={styles.input}
            placeholder="API Key"
            placeholderTextColor="#666"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={prefs.searchApiKey}
            onChangeText={v => patch({ searchApiKey: v })}
          />
        )}

        <Text style={styles.sectionTitle}>Pals 人设</Text>
        {prefs.pals.map(pal => (
          <View key={pal.id} style={styles.palRow}>
            <Pressable
              style={[styles.palNameBtn, prefs.activePalId === pal.id && styles.segActive]}
              onPress={() => patch({ activePalId: pal.id })}
            >
              <Text style={styles.segText}>{pal.name}</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                patch({
                  pals: prefs.pals.filter(x => x.id !== pal.id),
                  activePalId: prefs.activePalId === pal.id ? '' : prefs.activePalId,
                })
              }
            >
              <Text style={styles.delText}>删</Text>
            </Pressable>
          </View>
        ))}
        <TextInput
          style={styles.input}
          placeholder="人设名称，如「写作助手」"
          placeholderTextColor="#666"
          value={palName}
          onChangeText={setPalName}
        />
        <TextInput
          style={[styles.input, styles.multiline]}
          multiline
          placeholder="系统提示词（可留空=用默认）"
          placeholderTextColor="#666"
          value={palPrompt}
          onChangeText={setPalPrompt}
        />
        <Pressable style={[styles.btn, styles.btnGhost]} onPress={addPal}>
          <Text style={styles.btnText}>添加 Pals</Text>
        </Pressable>

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
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: 8, gap: 6 },
  iconBtn: { padding: 8 },
  iconText: { color: '#eee', fontSize: 20 },
  headerTitle: { color: '#eee', fontSize: 16, fontWeight: '600' },
  root: { flex: 1, backgroundColor: '#0e0e10' },
  hint: { color: '#777', fontSize: 12, marginBottom: 16 },
  label: { color: '#8ab4af', fontSize: 13, marginTop: 14, marginBottom: 6 },
  sectionTitle: { color: '#eee', fontSize: 14, fontWeight: '600', marginTop: 22, marginBottom: 8 },
  input: {
    backgroundColor: '#1c1c1f',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#eee',
    fontSize: 15,
    marginBottom: 4,
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  rowBtns: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  segBtn: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#1c1c1f',
  },
  segActive: { backgroundColor: '#2f6f6a' },
  segText: { color: '#eee', fontSize: 13 },
  palRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  palNameBtn: {
    flex: 1,
    backgroundColor: '#1c1c1f',
    borderRadius: 8,
    padding: 10,
  },
  delText: { color: '#c66', fontSize: 13, paddingHorizontal: 8 },
  btn: {
    marginTop: 18,
    backgroundColor: '#2f6f6a',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnGhost: { marginTop: 10, backgroundColor: '#2a3a38' },
  btnDisabled: { opacity: 0.45 },
  btnDanger: { backgroundColor: '#5a2d2d', marginTop: 12 },
  btnText: { color: '#fff', fontWeight: '600' },
  toast: { color: '#8ab4af', textAlign: 'center', marginTop: 10, fontSize: 13 },
});
