import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MODEL_CATALOG, type ModelEntry } from '../models/catalog';
import {
  deleteModel,
  downloadGguf,
  downloadModel,
  isDownloaded,
  listLocalModels,
  localPathFor,
  searchHfGguf,
  type HfHit,
} from '../models/download';
import {
  importFromPath,
  importGgufFiles,
  importGgufFromFolder,
  isCancel,
  loadExternalModels,
  unregisterModel,
  type ExternalModel,
} from '../models/importLocal';

type RowState = { downloaded: boolean; pct: number; busy: boolean; error?: string };

/** 内存需求提示（对标 PocketPal MemoryRequirement，按体积粗估） */
function memHint(approxSize: string): string {
  const n = parseFloat(approxSize.replace(/[^0-9.]/g, ''));
  if (!n) {
    return '';
  }
  if (approxSize.includes('GB') && n >= 1.5) {
    return '⚡ 建议空闲 RAM ≥ 8GB';
  }
  return '✓ 一般手机可跑（建议 RAM ≥ 4GB）';
}

export type ModelScreenProps = {
  /** 选中后把本地路径交给聊天页加载 */
  onPick: (path: string) => void;
  currentPath?: string;
  onOpenDrawer?: () => void;
};

export default function ModelScreen({ onPick, currentPath, onOpenDrawer }: ModelScreenProps) {
  const [state, setState] = useState<Record<string, RowState>>({});
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<HfHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [localFiles, setLocalFiles] = useState<string[]>([]);
  const [external, setExternal] = useState<ExternalModel[]>([]);
  const [importMsg, setImportMsg] = useState('');
  const [pathText, setPathText] = useState('');

  const refresh = useCallback(async () => {
    const next: Record<string, RowState> = {};
    for (const m of MODEL_CATALOG) {
      next[m.id] = {
        downloaded: await isDownloaded(m),
        pct: 0,
        busy: false,
      };
    }
    setState(next);
  }, []);

  const reloadLocal = useCallback(async () => {
    setLocalFiles(await listLocalModels());
    setExternal(await loadExternalModels());
  }, []);

  useEffect(() => {
    refresh();
    reloadLocal();
  }, [refresh, reloadLocal]);

  const afterImport = async (
    result: { imported: string[]; skipped: string[]; error?: string },
    label: string,
  ) => {
    const parts: string[] = [];
    if (result.imported.length) {
      parts.push(`${label}：已导入 ${result.imported.length} 个`);
    } else {
      parts.push(`${label}：未导入任何 .gguf`);
    }
    if (result.skipped.length) {
      parts.push(`跳过 ${result.skipped.length} 个非 .gguf/失败`);
    }
    if (result.error) {
      parts.push(result.error);
    }
    setImportMsg(parts.join('；'));
    if (result.imported.length) {
      onPick(result.imported[0]);
    }
    await reloadLocal();
    refresh();
    setTimeout(() => setImportMsg(''), 6000);
  };

  const download = useCallback(async (entry: ModelEntry) => {
    setState(s => ({ ...s, [entry.id]: { ...s[entry.id], busy: true, pct: 0, error: undefined } }));
    try {
      const path = await downloadModel(entry, pct => {
        setState(s => ({ ...s, [entry.id]: { ...s[entry.id], pct } }));
      });
      setState(s => ({ ...s, [entry.id]: { downloaded: true, pct: 1, busy: false } }));
      onPick(path);
    } catch (e) {
      setState(s => ({
        ...s,
        [entry.id]: { downloaded: false, pct: 0, busy: false, error: String(e) },
      }));
    }
  }, [onPick]);

  const renderItem = ({ item }: { item: ModelEntry }) => {
    const st = state[item.id] ?? { downloaded: false, pct: 0, busy: false };
    const active = currentPath === localPathFor(item);
    return (
      <View style={[styles.card, active && styles.cardActive]}>
        <View style={styles.cardMain}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.meta}>
            {item.approxSize}
            {item.note ? ` · ${item.note}` : ''}
          </Text>
          <Text style={styles.memBadge}>{memHint(item.approxSize)}</Text>
          {st.busy && (
            <Text style={styles.progress}>下载中 {Math.round(st.pct * 100)}%</Text>
          )}
          {st.error ? <Text style={styles.error}>{st.error}</Text> : null}
        </View>
        <View style={styles.actions}>
          {st.downloaded ? (
            <>
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                onPress={() => onPick(localPathFor(item))}
              >
                <Text style={styles.btnText}>{active ? '已选' : '选用'}</Text>
              </Pressable>
              <Pressable
                style={styles.btnGhost}
                onPress={async () => {
                  await deleteModel(item);
                  refresh();
                }}
              >
                <Text style={styles.btnGhostText}>删</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              style={[styles.btn, styles.btnPrimary, st.busy && styles.btnDisabled]}
              onPress={() => download(item)}
              disabled={st.busy}
            >
              {st.busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnText}>下载</Text>}
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  return (
    <>
    <View style={styles.header}>
      <Pressable style={styles.iconBtn} onPress={onOpenDrawer} hitSlop={8}>
        <Text style={styles.iconText}>☰</Text>
      </Pressable>
      <Text style={styles.headerTitle}>模型</Text>
    </View>
    <FlatList
      style={styles.root}
      data={MODEL_CATALOG}
      keyExtractor={m => m.id}
      renderItem={renderItem}
      contentContainerStyle={{ padding: 12 }}
      ListHeaderComponent={
        <View>
          <Text style={styles.hint}>从 Hugging Face 下载 GGUF，全部存本机 App 沙箱</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <Pressable
              style={[styles.btn, styles.btnPrimary, { flex: 1 }]}
              onPress={async () => {
                try {
                  const r = await importGgufFiles();
                  await afterImport(r, '导入文件');
                } catch (e) {
                  if (!isCancel(e)) setImportMsg(String(e));
                }
              }}
            >
              <Text style={styles.btnText}>导入 .gguf 文件</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { flex: 1, backgroundColor: '#2a3a38' }]}
              onPress={async () => {
                try {
                  const r = await importGgufFromFolder();
                  await afterImport(r, '导入文件夹');
                } catch (e) {
                  if (!isCancel(e)) setImportMsg(String(e));
                }
              }}
            >
              <Text style={styles.btnText}>选择文件夹</Text>
            </Pressable>
          </View>
          {importMsg ? <Text style={styles.progress}>{importMsg}</Text> : null}
          <Text style={[styles.hint, { marginBottom: 6, lineHeight: 18 }]}>
            · 选文件：直接点「导入 .gguf 文件」，在文件管理里选中模型文件{'\n'}
            · 选文件夹：系统不允许授权 Download 根目录，请选**子文件夹**（如
            Download/models）{'\n'}
            · 大模型（1GB 以上）推荐：点下面「授权文件访问」→ 填绝对路径，**不复制、原地加载**
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="/sdcard/Download/xxx.gguf"
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoCorrect={false}
              value={pathText}
              onChangeText={setPathText}
            />
            <Pressable
              style={[styles.btn, styles.btnPrimary]}
              onPress={async () => {
                if (!pathText.trim()) return;
                const r = await importFromPath(pathText.trim());
                await afterImport(r, '按路径导入');
                if (r.imported.length) setPathText('');
              }}
            >
              <Text style={styles.btnText}>导入</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.btn, { backgroundColor: '#2a3a38', marginBottom: 12 }]}
            onPress={() => {
              if (Platform.OS === 'android') {
                Linking.sendIntent('android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION', [
                  { key: 'package', value: 'com.latiaoandroid' },
                ]).catch(() => {
                  Linking.openSettings().catch(() => undefined);
                });
              } else {
                Linking.openSettings().catch(() => undefined);
              }
            }}
          >
            <Text style={styles.btnText}>授权文件访问（按路径导入需要）</Text>
          </Pressable>
          {(localFiles.length > 0 || external.length > 0) && (
            <View style={{ marginBottom: 10 }}>
              <Text style={styles.hint}>本机已导入（点选即用，大模型不复制原地加载）</Text>
              {localFiles.map(fp => (
                <Pressable key={fp} onPress={() => onPick(fp)}>
                  <Text style={styles.meta} numberOfLines={1}>
                    📄 {fp.split('/').pop()}（沙箱）
                  </Text>
                </Pressable>
              ))}
              {external.map(m => (
                <View key={m.path} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Pressable style={{ flex: 1 }} onPress={() => onPick(m.path)}>
                    <Text style={styles.meta} numberOfLines={1}>
                      📄 {m.name}
                    </Text>
                    <Text style={[styles.meta, { fontSize: 10 }]} numberOfLines={1}>
                      {m.path}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      await unregisterModel(m.path);
                      await reloadLocal();
                    }}
                  >
                    <Text style={{ color: '#c66', paddingHorizontal: 8 }}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="搜索 Hugging Face 模型…"
              placeholderTextColor="#666"
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={async () => {
                if (!query.trim()) return;
                setSearching(true);
                setSearchErr('');
                try {
                  setHits(await searchHfGguf(query.trim()));
                } catch (e) {
                  setSearchErr(String(e));
                  setHits([]);
                } finally {
                  setSearching(false);
                }
              }}
            />
            <Pressable
              style={[styles.btn, styles.btnPrimary]}
              onPress={async () => {
                if (!query.trim()) return;
                setSearching(true);
                setSearchErr('');
                try {
                  setHits(await searchHfGguf(query.trim()));
                } catch (e) {
                  setSearchErr(String(e));
                  setHits([]);
                } finally {
                  setSearching(false);
                }
              }}
            >
              <Text style={styles.btnText}>{searching ? '…' : '搜索'}</Text>
            </Pressable>
          </View>
          {searchErr ? <Text style={styles.error}>{searchErr}</Text> : null}
          {hits.map(h => (
            <View key={h.id} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{h.id}</Text>
                <Text style={styles.meta}>下载 {h.downloads} · {h.ggufFiles[0]}</Text>
              </View>
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                onPress={async () => {
                  const file = h.ggufFiles[0];
                  const key = `hf-${h.id}-${file}`;
                  setState(s => ({ ...s, [key]: { downloaded: false, pct: 0, busy: true } }));
                  try {
                    const path = await downloadGguf(h.id, file, pct => {
                      setState(s => ({ ...s, [key]: { ...s[key], pct } }));
                    });
                    setState(s => ({ ...s, [key]: { downloaded: true, pct: 1, busy: false } }));
                    onPick(path);
                  } catch (e) {
                    setState(s => ({
                      ...s,
                      [key]: { downloaded: false, pct: 0, busy: false, error: String(e) },
                    }));
                  }
                }}
              >
                <Text style={styles.btnText}>
                  {state[`hf-${h.id}-${h.ggufFiles[0]}`]?.busy
                    ? `${Math.round((state[`hf-${h.id}-${h.ggufFiles[0]}`]?.pct ?? 0) * 100)}%`
                    : '下载'}
                </Text>
              </Pressable>
            </View>
          ))}
          <Text style={[styles.hint, { marginTop: 8 }]}>—— 内置精选 ——</Text>
        </View>
      }
    />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e0e10' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 8, gap: 6 },
  iconBtn: { padding: 8 },
  iconText: { color: '#eee', fontSize: 20 },
  headerTitle: { color: '#eee', fontSize: 16, fontWeight: '600' },
  hint: { color: '#777', fontSize: 12, marginBottom: 10 },
  card: {
    backgroundColor: '#1c1c1f',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardActive: { borderColor: '#2f6f6a' },
  cardMain: { flex: 1 },
  name: { color: '#eee', fontSize: 15, fontWeight: '600' },
  meta: { color: '#888', fontSize: 12, marginTop: 4 },
  memBadge: { color: '#8ab4af', fontSize: 11, marginTop: 4 },
  progress: { color: '#8ab4af', fontSize: 12, marginTop: 6 },
  error: { color: '#e07a7a', fontSize: 12, marginTop: 6 },
  input: {
    backgroundColor: '#1c1c1f',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#eee',
    fontSize: 14,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, minWidth: 56, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#2f6f6a' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  btnGhost: { paddingHorizontal: 8, paddingVertical: 9 },
  btnGhostText: { color: '#888', fontSize: 13 },
});
