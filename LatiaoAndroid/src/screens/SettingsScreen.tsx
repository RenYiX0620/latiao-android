import { useEffect, useState, useMemo } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  DEFAULT_PREFS_EXT,
  deleteAllSessions,
  loadPrefsExt,
  modelKey,
  resolveParams,
  savePrefsExt,
  type ModelParams,
  type Pal,
  type PrefsExt,
} from '../store/prefs';
import { useTheme, type Theme, type ThemeMode } from '../theme';
import { useT, type Lang, type MsgKey } from '../i18n';

/**
 * 设置：模型参数 + 联网搜索 Key + Pals 人设 + 清会话。
 * 数字项改为「失焦才 clamp」——逐键 clamp 会让用户根本改不了值（删到 3 直接跳 512）。
 */

type Props = {
  onSaved?: (p: PrefsExt) => void;
  onOpenDrawer?: () => void;
  onSessionsCleared?: () => void | Promise<void>;
  themeMode?: ThemeMode;
  onThemeModeChange?: (m: ThemeMode) => void;
  lang?: Lang;
  onLangChange?: (l: Lang) => void;
};

export default function SettingsScreen({
  onSaved,
  onOpenDrawer,
  onSessionsCleared,
  themeMode = 'system',
  onThemeModeChange,
  lang = 'zh',
  onLangChange,
}: Props) {
  const i18n = useT();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [prefs, setPrefs] = useState<PrefsExt>(DEFAULT_PREFS_EXT);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState('');
  const [palName, setPalName] = useState('');
  const [palPrompt, setPalPrompt] = useState('');
  /** 正在编辑中的数字文本（未提交） */
  const [editing, setEditing] = useState<Record<string, string>>({});

  useEffect(() => {
    loadPrefsExt().then(p => setPrefs(p));
  }, []);

  const patch = (p: Partial<PrefsExt>) => {
    setPrefs(s => ({ ...s, ...p }));
    setDirty(true);
  };

  /** 数字项：输入时只记文本，失焦/回车才 clamp 提交 */
  const numProps = (
    key:
      | 'temperature'
      | 'nGpuLayers'
      | 'nThreads'
      | 'nCtx'
      | 'topP'
      | 'topK'
      | 'minP'
      | 'penaltyRepeat'
      | 'seed'
      | 'nPredict',
    min: number,
    max: number,
    fallback: number,
    decimal = false,
  ) => ({
    value: editing[key] ?? String(prefs[key]),
    keyboardType: decimal ? ('decimal-pad' as const) : ('number-pad' as const),
    onChangeText: (v: string) => setEditing(e => ({ ...e, [key]: v })),
    onEndEditing: () => {
      const raw = editing[key];
      if (raw === undefined) {
        return;
      }
      const n = Number(raw);
      const val = Number.isFinite(n) && raw.trim() !== ''
        ? Math.min(max, Math.max(min, n))
        : fallback;
      setEditing(e => {
        const next = { ...e };
        delete next[key];
        return next;
      });
      patch({ [key]: val } as Partial<PrefsExt>);
    },
  });

  const save = async () => {
    try {
      await savePrefsExt(prefs);
      setDirty(false);
      setToast(i18n('settings.saved'));
      onSaved?.(prefs);
    } catch (e) {
      setToast(i18n('settings.saveFailed', { msg: String(e) }));
    } finally {
      setTimeout(() => setToast(''), 2000);
    }
  };

  // ── 模型专属参数 ──────────────────────────────────────
  const currentModel = modelKey(prefs.modelPath);
  const override: ModelParams = (currentModel && prefs.modelParams?.[currentModel]) || {};
  const hasOverride = Object.keys(override).length > 0;

  const setOverride = (o: ModelParams | null) => {
    const next = { ...(prefs.modelParams ?? {}) };
    if (o && Object.keys(o).length) {
      next[currentModel] = o;
    } else {
      delete next[currentModel];
    }
    patch({ modelParams: next });
  };

  /** 覆盖项的数字输入：空 = 跟随全局 */
  const overrideNum = (
    key: 'nCtx' | 'temperature' | 'nPredict',
    min: number,
    max: number,
    decimal = false,
  ) => {
    const editingKey = `ov:${currentModel}:${key}`;
    const cur = override[key];
    return {
      value: editing[editingKey] ?? (cur !== undefined ? String(cur) : ''),
      placeholder: String(prefs[key]),
      placeholderTextColor: t.textDim,
      keyboardType: decimal ? ('decimal-pad' as const) : ('number-pad' as const),
      onChangeText: (v: string) => setEditing(e => ({ ...e, [editingKey]: v })),
      onEndEditing: () => {
        const raw = editing[editingKey];
        if (raw === undefined) {
          return;
        }
        const trimmed = raw.trim();
        setEditing(e => {
          const n = { ...e };
          delete n[editingKey];
          return n;
        });
        if (!trimmed) {
          const next = { ...override };
          delete next[key];
          setOverride(next);
          return;
        }
        const n = Number(trimmed);
        if (!Number.isFinite(n)) {
          return;
        }
        setOverride({ ...override, [key]: Math.min(max, Math.max(min, n)) });
      },
    };
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
        <Text style={styles.headerTitle}>{i18n('settings.title')}</Text>
      </View>
      <ScrollView style={styles.root} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Text style={styles.hint}>{i18n('settings.topHint')}</Text>

        <Text style={styles.sectionTitle}>{i18n('settings.appearance')}</Text>
        <View style={styles.rowBtns}>
          {(
            [
              ['dark', 'dark'],
              ['light', 'light'],
              ['system', 'system'],
            ] as const
          ).map(([k, label]) => (
            <Pressable
              key={k}
              style={[styles.segBtn, themeMode === k && styles.segActive]}
              onPress={() => {
                patch({ themeMode: k });
                onThemeModeChange?.(k);
              }}
            >
              <Text style={styles.segText}>{i18n(`settings.theme.${label}` as MsgKey)}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Temperature（0–2）</Text>
        <TextInput style={styles.input} {...numProps('temperature', 0, 2, 0.7, true)} />

        <Text style={styles.label}>{i18n('settings.gpuLayers')}</Text>
        <TextInput style={styles.input} {...numProps('nGpuLayers', 0, 999, 0)} />

        <Text style={styles.label}>{i18n('settings.threads')}</Text>
        <TextInput style={styles.input} {...numProps('nThreads', 1, 32, 4)} />

        <Text style={styles.label}>{i18n('settings.nCtx')}</Text>
        <TextInput style={styles.input} {...numProps('nCtx', 512, 32768, 4096)} />

        <Text style={styles.sectionTitle}>{i18n('settings.lang')}</Text>
        <View style={styles.rowBtns}>
          {(
            [
              ['zh', '中文'],
              ['en', 'English'],
            ] as const
          ).map(([k, label]) => (
            <Pressable
              key={k}
              style={[styles.segBtn, lang === k && styles.segActive]}
              onPress={() => {
                patch({ lang: k });
                onLangChange?.(k);
              }}
            >
              <Text style={styles.segText}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>{i18n('settings.sampling')}</Text>
        <Text style={styles.hint}>{i18n('settings.samplingHint')}</Text>

        <Text style={styles.label}>{i18n('settings.topP')}</Text>
        <TextInput style={styles.input} {...numProps('topP', 0, 1, 0.95, true)} />

        <Text style={styles.label}>{i18n('settings.topK')}</Text>
        <TextInput style={styles.input} {...numProps('topK', 0, 200, 40)} />

        <Text style={styles.label}>{i18n('settings.minP')}</Text>
        <TextInput style={styles.input} {...numProps('minP', 0, 1, 0.05, true)} />

        <Text style={styles.label}>{i18n('settings.penalty')}</Text>
        <TextInput style={styles.input} {...numProps('penaltyRepeat', 0, 2, 1.1, true)} />

        <Text style={styles.label}>{i18n('settings.seed')}</Text>
        <TextInput style={styles.input} {...numProps('seed', -1, 2147483647, -1)} />

        <Text style={styles.label}>{i18n('settings.nPredict')}</Text>
        <TextInput style={styles.input} {...numProps('nPredict', 16, 8192, 1024)} />

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{i18n('settings.thinking')}</Text>
            <Text style={styles.hint}>{i18n('settings.thinkingHint')}</Text>
          </View>
          <Switch
            value={prefs.enableThinking}
            onValueChange={v => patch({ enableThinking: v })}
            trackColor={{ false: t.switchOff, true: t.accent }}
            thumbColor={t.surface}
          />
        </View>

        <Text style={styles.sectionTitle}>{i18n('settings.modelParams')}</Text>
        <Text style={styles.hint}>{i18n('settings.modelParamsHint')}</Text>
        {currentModel ? (
          <>
            <Text style={styles.label} numberOfLines={1}>
              {i18n('settings.currentModel', { name: currentModel })}
            </Text>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>{i18n('settings.overrideOn')}</Text>
                <Text style={styles.hint}>
                  {hasOverride ? i18n('settings.overrideCount', { n: Object.keys(override).length }) : i18n('settings.overrideInherit')}
                </Text>
              </View>
              <Switch
                value={hasOverride}
                onValueChange={on => {
                  if (!on) {
                    setOverride(null);
                    return;
                  }
                  const rp = resolveParams(prefs, prefs.modelPath);
                  setOverride({
                    nCtx: rp.nCtx,
                    temperature: rp.temperature,
                    nPredict: rp.nPredict,
                    enableThinking: rp.enableThinking,
                  });
                }}
                trackColor={{ false: t.switchOff, true: t.accent }}
                thumbColor={t.surface}
              />
            </View>
            {hasOverride ? (
              <>
                <Text style={styles.label}>
                  {i18n('settings.nCtxGlobal', { v: prefs.nCtx })}
                </Text>
                <TextInput style={styles.input} {...overrideNum('nCtx', 512, 32768)} />

                <Text style={styles.label}>
                  {i18n('settings.tempGlobal', { v: prefs.temperature })}
                </Text>
                <TextInput
                  style={styles.input}
                  {...overrideNum('temperature', 0, 2, true)}
                />

                <Text style={styles.label}>
                  {i18n('settings.nPredictGlobal', { v: prefs.nPredict })}
                </Text>
                <TextInput
                  style={styles.input}
                  {...overrideNum('nPredict', 16, 8192)}
                />

                <View style={styles.switchRow}>
                  <Text style={styles.label}>{i18n('settings.thinkingOverride')}</Text>
                  <Switch
                    value={override.enableThinking ?? prefs.enableThinking}
                    onValueChange={v => setOverride({ ...override, enableThinking: v })}
                    trackColor={{ false: t.switchOff, true: t.accent }}
                    thumbColor={t.surface}
                  />
                </View>
                <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setOverride(null)}>
                  <Text style={styles.btnText}>{i18n('settings.overrideClear')}</Text>
                </Pressable>
              </>
            ) : null}
          </>
        ) : (
          <Text style={styles.hint}>{i18n('settings.overrideEmpty')}</Text>
        )}
        <Text style={styles.hint}>
          {i18n('settings.overrideCount2', { n: Object.keys(prefs.modelParams ?? {}).length })}
        </Text>

        <Text style={styles.label}>{i18n('settings.systemPrompt')}</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          multiline
          value={prefs.systemPrompt}
          onChangeText={v => patch({ systemPrompt: v })}
        />

        <Text style={styles.sectionTitle}>{i18n('settings.search')}</Text>
        <View style={styles.rowBtns}>
          {(
            [
              ['none', 'none'],
              ['tavily', 'Tavily'],
              ['brave', 'Brave'],
            ] as const
          ).map(([k, label]) => (
            <Pressable
              key={k}
              style={[styles.segBtn, prefs.searchProvider === k && styles.segActive]}
              onPress={() => patch({ searchProvider: k })}
            >
              <Text style={styles.segText}>
                {k === 'none' ? i18n('common.close') : label}
              </Text>
            </Pressable>
          ))}
        </View>
        {prefs.searchProvider !== 'none' && (
          <TextInput
            style={styles.input}
            placeholder="API Key"
            placeholderTextColor={t.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={prefs.searchApiKey}
            onChangeText={v => patch({ searchApiKey: v })}
          />
        )}

        <Text style={styles.sectionTitle}>{i18n('settings.pals')}</Text>
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
              <Text style={styles.delText}>{i18n('common.delete')}</Text>
            </Pressable>
          </View>
        ))}
        <TextInput
          style={styles.input}
          placeholder={i18n('settings.palNamePlaceholder')}
          placeholderTextColor={t.textDim}
          value={palName}
          onChangeText={setPalName}
        />
        <TextInput
          style={[styles.input, styles.multiline]}
          multiline
          placeholder={i18n('settings.palPromptPlaceholder')}
          placeholderTextColor={t.textDim}
          value={palPrompt}
          onChangeText={setPalPrompt}
        />
        <Pressable style={[styles.btn, styles.btnGhost]} onPress={addPal}>
          <Text style={styles.btnText}>{i18n('settings.addPal')}</Text>
        </Pressable>

        <Pressable
          style={[styles.btn, !dirty && styles.btnDisabled]}
          onPress={save}
          disabled={!dirty}
        >
          <Text style={styles.btnText}>{dirty ? i18n('settings.saveBtn') : i18n('settings.saved')}</Text>
        </Pressable>
        {toast ? <Text style={styles.toast}>{toast}</Text> : null}

        <Pressable
          style={[styles.btn, styles.btnDanger]}
          onPress={() => {
            Alert.alert(i18n('settings.clearSessions'), i18n('settings.clearConfirm'), [
              { text: i18n('common.cancel'), style: 'cancel' },
              {
                text: i18n('common.delete'),
                style: 'destructive',
                onPress: async () => {
                  try {
                    await deleteAllSessions();
                    await onSessionsCleared?.();
                    setToast(i18n('settings.clearDone'));
                  } catch (e) {
                    setToast(i18n('settings.clearFailed', { msg: String(e) }));
                  } finally {
                    setTimeout(() => setToast(''), 2000);
                  }
                },
              },
            ]);
          }}
        >
          <Text style={styles.btnText}>{i18n('settings.clearSessions')}</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: 8, gap: 6 },
  iconBtn: { padding: 8 },
  iconText: { color: t.text, fontSize: 20 },
  headerTitle: { color: t.text, fontSize: 16, fontWeight: '600' },
  root: { flex: 1, backgroundColor: t.bg },
  hint: { color: t.textDim, fontSize: 12, marginBottom: 16 },
  label: { color: t.accentSoft, fontSize: 13, marginTop: 14, marginBottom: 6 },
  sectionTitle: { color: t.text, fontSize: 14, fontWeight: '600', marginTop: 22, marginBottom: 8 },
  input: {
    backgroundColor: t.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: t.text,
    fontSize: 15,
    marginBottom: 4,
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  rowBtns: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  segBtn: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: t.surface,
  },
  segActive: { backgroundColor: t.accent },
  segText: { color: t.text, fontSize: 13 },
  palRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
  },
  palNameBtn: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: 8,
    padding: 10,
  },
  delText: { color: t.dangerText, fontSize: 13, paddingHorizontal: 8 },
  btn: {
    marginTop: 18,
    backgroundColor: t.accent,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnGhost: { marginTop: 10, backgroundColor: t.surfaceAlt },
  btnDisabled: { opacity: 0.45 },
  btnDanger: { backgroundColor: t.dangerBg, marginTop: 12 },
  btnText: { color: t.accentText, fontWeight: '600' },
  toast: { color: t.accentSoft, textAlign: 'center', marginTop: 10, fontSize: 13 },
});
