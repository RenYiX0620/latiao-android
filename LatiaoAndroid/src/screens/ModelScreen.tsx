import { useCallback, useEffect, useState, useMemo } from 'react';
import { Linking, Modal, Platform, ScrollView } from 'react-native';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import { MODEL_CATALOG, type ModelEntry } from '../models/catalog';
import {
  assertSpace,
  deleteModel,
  downloadGguf,
  downloadModel,
  isDownloaded,
  listLocalModels,
  listRepoGguf,
  localPathFor,
  localPathForRepo,
  searchHfGguf,
  type HfHit,
  type RepoFile,
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
import { getLoadedPath, unloadModel } from '../llama/engine';
import { loadPrefsExt } from '../store/prefs';
import { isProjectorFile } from '../models/vision';
import { useTheme, type Theme } from '../theme';
import { useT, type TFn } from '../i18n';

type RowState = {
  downloaded: boolean;
  pct: number;
  busy: boolean;
  error?: string;
  /** 正在跑的下载任务 id（用于取消） */
  jobId?: number;
  /** 半成品落盘路径：取消时一并清掉，别让残file被下次续传/误判 */
  dest?: string;
};

/**
 * 内存需求提示：模型文件 + 上下文缓存（KV）。
 * KV 按 ~16MB/1k token 粗估（1.5B 档 Qwen 实测约 28KB/token），仅供参考。
 */
function memHint(i18n: TFn, approxSize: string, nCtx: number): string {
  const n = parseFloat(approxSize.replace(/[^0-9.]/g, ''));
  if (!n) {
    return '';
  }
  const isGb = /GB/i.test(approxSize);
  const modelGb = isGb ? n : n / 1024;
  const kvGb = (nCtx / 1000) * 0.016;
  const total = modelGb + kvGb;
  const note = i18n('model.memTotal', {
    model: modelGb.toFixed(1),
    kv: kvGb.toFixed(1),
  });
  if (total >= 4) {
    return i18n('model.memNo', { total: total.toFixed(1), note });
  }
  if (total >= 2.5) {
    return i18n('model.memTight', { total: total.toFixed(1), note });
  }
  return i18n('model.memOk', { total: total.toFixed(1), note });
}

function fmtSize(i18n: TFn, bytes: number): string {
  if (!bytes) {
    return i18n('model.sizeUnknown');
  }
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

export type ModelScreenProps = {
  /** 选中后把本地路径交给聊天页加载 */
  onPick: (path: string) => void;
  currentPath?: string;
  onOpenDrawer?: () => void;
};

export default function ModelScreen({ onPick, currentPath, onOpenDrawer }: ModelScreenProps) {
    const i18n = useT();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
const [state, setState] = useState<Record<string, RowState>>({});
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<HfHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [localFiles, setLocalFiles] = useState<string[]>([]);
  const [external, setExternal] = useState<ExternalModel[]>([]);
  const [importMsg, setImportMsg] = useState('');
  const [pathText, setPathText] = useState('');
  /** n_ctx 用于估算上下文缓存内存占用 */
  const [nCtx, setNCtx] = useState(4096);
  /** 文件选择器：正在为哪个仓库选文件 */
  const [pickFor, setPickFor] = useState<HfHit | null>(null);
  const [pickFiles, setPickFiles] = useState<RepoFile[]>([]);
  const [pickLoading, setPickLoading] = useState(false);
  const [pickErr, setPickErr] = useState('');

  useEffect(() => {
    loadPrefsExt()
      .then(p => setNCtx(p.nCtx))
      .catch(() => undefined);
  }, []);

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
      parts.push(i18n('model.importedCount', { label, n: result.imported.length }));
    } else {
      parts.push(i18n('model.importedNone', { label }));
    }
    if (result.skipped.length) {
      parts.push(i18n('model.skipped', { n: result.skipped.length }));
    }
    if (result.error) {
      parts.push(result.error);
    }
    setImportMsg(parts.join(' · '));
    if (result.imported.length) {
      Alert.alert(i18n('model.importOkTitle'), i18n('model.importOkBody', { n: result.imported.length }));
      onPick(result.imported[0]);
    }
    await reloadLocal();
    refresh();
    setTimeout(() => setImportMsg(''), 6000);
  };

  /** 内置目录下载：先看空间，再下载，可取消 */
  const download = useCallback(
    async (entry: ModelEntry) => {
      const approxBytes = /GB/i.test(entry.approxSize)
        ? parseFloat(entry.approxSize.replace(/[^0-9.]/g, '')) * 1e9
        : parseFloat(entry.approxSize.replace(/[^0-9.]/g, '')) * 1e6;
      try {
        await assertSpace(Number.isFinite(approxBytes) ? approxBytes : 0);
      } catch (e) {
        setState(s => ({
          ...s,
          [entry.id]: { ...s[entry.id], busy: false, error: String(e) },
        }));
        return;
      }
      setState(s => ({ ...s, [entry.id]: { ...s[entry.id], busy: true, pct: 0, error: undefined, dest: localPathFor(entry) } }));
      try {
        const path = await downloadModel(
          entry,
          pct => setState(s => ({ ...s, [entry.id]: { ...s[entry.id], pct } })),
          job => setState(s => ({ ...s, [entry.id]: { ...s[entry.id], jobId: job.jobId } })),
        );
        setState(s => ({ ...s, [entry.id]: { downloaded: true, pct: 1, busy: false } }));
        onPick(path);
      } catch (e) {
        setState(s => ({
          ...s,
          [entry.id]: { ...s[entry.id], downloaded: false, pct: 0, busy: false, error: String(e) },
        }));
      }
    },
    [onPick],
  );

  const cancelDownload = useCallback(async (key: string) => {
    const st = state[key];
    if (st?.jobId !== undefined) {
      try {
        // RNFS 的类型签名写的是 void，实现返回 promise；这里不依赖它
        void RNFS.stopDownload(st.jobId);
      } catch {
        /* 任务可能已结束 */
      }
    }
    // 清掉半截文件：不然它会被当成"已下载"或被下次下载续传成坏文件
    if (st?.dest) {
      await RNFS.unlink(st.dest).catch(() => undefined);
    }
    setState(s => ({
      ...s,
      [key]: { ...s[key], busy: false, pct: 0, jobId: undefined, dest: undefined, error: i18n('model.canceled') },
    }));
  }, [state, i18n]);

  /** 打开某仓库的文件列表（带体积，分片会标注） */
  const openPicker = useCallback(async (hit: HfHit) => {
    setPickFor(hit);
    setPickFiles([]);
    setPickErr('');
    setPickLoading(true);
    try {
      const files = await listRepoGguf(hit.id);
      setPickFiles(files);
      if (!files.length) {
        setPickErr(i18n('model.repoEmpty'));
      }
    } catch (e) {
      setPickErr(String(e));
    } finally {
      setPickLoading(false);
    }
  }, [, i18n]);

  const downloadFromRepo = useCallback(
    async (repo: string, file: RepoFile) => {
      const key = `hf-${repo}-${file.path}`;
      try {
        await assertSpace(file.size);
      } catch (e) {
        setState(s => ({ ...s, [key]: { downloaded: false, pct: 0, busy: false, error: String(e) } }));
        return;
      }
      setState(s => ({ ...s, [key]: { downloaded: false, pct: 0, busy: true, dest: localPathForRepo(repo, file.path) } }));
      try {
        const path = await downloadGguf(
          repo,
          file.path,
          pct => setState(s => ({ ...s, [key]: { ...s[key], pct } })),
          job => setState(s => ({ ...s, [key]: { ...s[key], jobId: job.jobId } })),
        );
        setState(s => ({ ...s, [key]: { downloaded: true, pct: 1, busy: false } }));
        setPickFor(null);
        onPick(path);
      } catch (e) {
        setState(s => ({
          ...s,
          [key]: { downloaded: false, pct: 0, busy: false, error: String(e) },
        }));
      }
    },
    [onPick],
  );

  const renderItem = ({ item }: { item: ModelEntry }) => {
    const st = state[item.id] ?? { downloaded: false, pct: 0, busy: false };
    const path = localPathFor(item);
    const active = currentPath === path;
    const inUse = getLoadedPath() === path;
    return (
      <View style={[styles.card, active && styles.cardActive]}>
        <View style={styles.cardMain}>
          <Text style={styles.name}>
            {item.name}
            {inUse ? `  ${i18n('model.inUse')}` : active ? `  ${i18n('model.selected')}` : ''}
          </Text>
          <Text style={styles.meta}>
            {item.approxSize}
            {item.note ? ` · ${item.note}` : ''}
          </Text>
          {item.toolCapable !== undefined ? (
            <Text style={styles.toolBadge}>
              {item.toolCapable ? i18n('model.toolCapable') : i18n('model.chatOnly')}
            </Text>
          ) : null}
          <Text style={styles.memBadge}>{memHint(i18n, item.approxSize, nCtx)}</Text>
          {st.busy && (
            <Text style={styles.progress}>{i18n('model.downloading', { pct: Math.round(st.pct * 100) })}</Text>
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
                <Text style={styles.btnText}>{active ? i18n('model.used') : i18n('model.use')}</Text>
              </Pressable>
              <Pressable
                style={styles.btnGhost}
                onPress={() => {
                  Alert.alert(i18n('model.deleteTitle'), i18n('model.deleteConfirm', { name: item.name, size: item.approxSize }), [
                    { text: i18n('common.cancel'), style: 'cancel' },
                    {
                      text: i18n('common.delete'),
                      style: 'destructive',
                      onPress: async () => {
                        if (getLoadedPath() === path) {
                          await unloadModel();
                        }
                        await deleteModel(item);
                        refresh();
                      },
                    },
                  ]);
                }}
              >
                <Text style={styles.btnGhostText}>{i18n('common.delete')}</Text>
              </Pressable>
            </>
          ) : st.busy ? (
            <Pressable style={[styles.btn, styles.btnDanger]} onPress={() => cancelDownload(item.id)}>
              <Text style={styles.btnText}>{i18n('common.cancel')}</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => download(item)}
            >
              <Text style={styles.btnText}>{i18n('common.download')}</Text>
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
      <Text style={styles.headerTitle}>{i18n('nav.models')}</Text>
    </View>
    <FlatList
      style={styles.root}
      data={MODEL_CATALOG}
      keyExtractor={m => m.id}
      renderItem={renderItem}
      contentContainerStyle={{ padding: 12 }}
      ListHeaderComponent={
        <View>
          <Text style={styles.hint}>{i18n('model.hint')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <Pressable
              style={[styles.btn, styles.btnPrimary, { flex: 1 }]}
              onPress={async () => {
                try {
                  const r = await importGgufFiles();
                  await afterImport(r, i18n('model.importLabels.file'));
                  if (r.error) {
                    Alert.alert(i18n('model.importHint'), r.error);
                  }
                } catch (e) {
                  if (!isCancel(e)) Alert.alert(i18n('model.importFailed'), String(e));
                }
              }}
            >
              <Text style={styles.btnText}>{i18n('model.pickFile')}</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { flex: 1, backgroundColor: t.surfaceAlt }]}
              onPress={async () => {
                try {
                  const r = await importGgufFromFolder();
                  await afterImport(r, i18n('model.importLabels.folder'));
                  if (r.error) {
                    Alert.alert(i18n('model.importHint'), r.error);
                  }
                } catch (e) {
                  if (!isCancel(e)) Alert.alert(i18n('model.importFailed'), String(e));
                }
              }}
            >
              <Text style={styles.btnText}>{i18n('model.pickFolder')}</Text>
            </Pressable>
          </View>
          {importMsg ? <Text style={styles.progress}>{importMsg}</Text> : null}
          <Text style={[styles.hint, { marginBottom: 6, lineHeight: 18 }]}>{i18n('model.pathHint')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="/sdcard/Download/xxx.gguf"
              placeholderTextColor={t.textDim}
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
                await afterImport(r, i18n('model.importLabels.path'));
                if (r.error) {
                  Alert.alert(i18n('model.pathImport'), r.error);
                }
                if (r.imported.length) setPathText('');
              }}
            >
              <Text style={styles.btnText}>{i18n('model.importPath')}</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.btn, { backgroundColor: t.surfaceAlt, marginBottom: 12 }]}
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
            <Text style={styles.btnText}>{i18n('model.grantAccess')}</Text>
          </Pressable>
          {(localFiles.length > 0 || external.length > 0) && (
            <View style={{ marginBottom: 10 }}>
              <Text style={styles.hint}>{i18n('model.imported')}</Text>
              <View style={{ maxHeight: 220 }}>
              {localFiles.map(fp => (
                <Pressable key={fp} style={styles.localRow} onPress={() => onPick(fp)}>
                  <Text style={styles.localIcon}>📄</Text>
                  <Text style={styles.localName} numberOfLines={1}>
                    {fp.split('/').pop()} · sandbox
                  </Text>
                </Pressable>
              ))}
              {external.map(m => (
                <View key={m.path} style={styles.localRow}>
                  <Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} onPress={() => onPick(m.path)}>
                    <Text style={styles.localIcon}>📄</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.localName} numberOfLines={1}>{m.name}</Text>
                      <Text style={styles.localPath} numberOfLines={1}>{m.path}</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      await unregisterModel(m.path);
                      await reloadLocal();
                    }}
                  >
                    <Text style={{ color: t.dangerText, paddingHorizontal: 8 }}>×</Text>
                  </Pressable>
                </View>
              ))}
              </View>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder={i18n('model.searchPlaceholder')}
              placeholderTextColor={t.textDim}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => {
                if (!query.trim()) return;
                runSearch(query).then(setHits).catch(() => undefined);
              }}
            />
            <Pressable
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => {
                if (!query.trim()) return;
                runSearch(query).then(setHits).catch(() => undefined);
              }}
            >
              <Text style={styles.btnText}>{searching ? '…' : i18n('common.search')}</Text>
            </Pressable>
          </View>
          {searchErr ? <Text style={styles.error}>{searchErr}</Text> : null}
          {hits.map(h => (
            <View key={h.id} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{h.id}</Text>
                <Text style={styles.meta}>{i18n('model.hitMeta', { n: h.downloads })}</Text>
              </View>
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                onPress={() => openPicker(h)}
              >
                <Text style={styles.btnText}>{i18n('model.chooseFile')}</Text>
              </Pressable>
            </View>
          ))}
          <Text style={[styles.hint, { marginTop: 8 }]}>{i18n('model.featured')}</Text>
        </View>
      }
    />

    {/* 文件选择器：列出量化档位与体积，避免盲下 BF16/分片 */}
    <Modal visible={!!pickFor} transparent animationType="slide" onRequestClose={() => setPickFor(null)}>
      <View style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle} numberOfLines={1}>{pickFor?.id}</Text>
          <Text style={styles.sheetHint}>{i18n('model.sheetHint')}</Text>
          {pickLoading ? (
            <ActivityIndicator color={t.accentSoft} style={{ marginVertical: 20 }} />
          ) : pickErr ? (
            <Text style={styles.error}>{pickErr}</Text>
          ) : (
            <ScrollView style={{ maxHeight: 420 }}>
              {pickFiles.map(f => {
                const key = `hf-${pickFor?.id}-${f.path}`;
                const st = state[key];
                return (
                  <View key={f.path} style={styles.fileRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fileName} numberOfLines={1}>
                        {isProjectorFile(f.path) ? '📷 ' : f.shard ? '⚠️ ' : ''}
                        {f.path.split('/').pop()}
                      </Text>
                      <Text style={styles.fileSize}>
                        {fmtSize(i18n, f.size)}
                        {st?.busy
                          ? ` · ${i18n('model.downloading', { pct: Math.round((st.pct ?? 0) * 100) })}`
                          : ''}
                        {st?.downloaded ? ` · ${i18n('model.downloadedTag')}` : ''}
                        {st?.error ? ` · ${st.error}` : ''}
                      </Text>
                    </View>
                    {st?.busy ? (
                      <Pressable
                        style={[styles.btn, styles.btnDanger]}
                        onPress={() => cancelDownload(key)}
                      >
                        <Text style={styles.btnText}>{i18n('common.cancel')}</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        style={[styles.btn, styles.btnPrimary]}
                        onPress={() => pickFor && downloadFromRepo(pickFor.id, f)}
                      >
                        <Text style={styles.btnText}>
                          {st?.downloaded ? i18n('model.downloadAgain') : i18n('common.download')}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}
          <Pressable style={[styles.btn, styles.btnGhost, { marginTop: 10 }]} onPress={() => setPickFor(null)}>
            <Text style={styles.btnText}>{i18n('common.close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
    </>
  );

  async function runSearch(q: string): Promise<HfHit[]> {
    setSearching(true);
    setSearchErr('');
    try {
      const r = await searchHfGguf(q.trim());
      if (!r.length) {
        setSearchErr(i18n('model.searchEmpty'));
      }
      return r;
    } catch (e) {
      setSearchErr(String(e));
      return [];
    } finally {
      setSearching(false);
    }
  }
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: 8, gap: 6 },
  iconBtn: { padding: 8 },
  iconText: { color: t.text, fontSize: 20 },
  headerTitle: { color: t.text, fontSize: 16, fontWeight: '600' },
  hint: { color: t.textDim, fontSize: 12, marginBottom: 10 },
  card: {
    backgroundColor: t.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardActive: { borderColor: t.accent },
  cardMain: { flex: 1 },
  name: { color: t.text, fontSize: 15, fontWeight: '600' },
  meta: { color: t.textDim, fontSize: 12, marginTop: 4 },
  toolBadge: { color: t.accentSoft, fontSize: 11, marginTop: 4 },
  memBadge: { color: t.accentSoft, fontSize: 11, marginTop: 4 },
  localRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    gap: 8,
  },
  localIcon: { fontSize: 13 },
  localName: { color: t.textMid, fontSize: 12, flex: 1 },
  localPath: { color: t.textFaint, fontSize: 10 },
  progress: { color: t.accentSoft, fontSize: 12, marginTop: 6 },
  error: { color: t.dangerText, fontSize: 12, marginTop: 6 },
  input: {
    backgroundColor: t.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: t.text,
    fontSize: 14,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, minWidth: 56, alignItems: 'center' },
  btnPrimary: { backgroundColor: t.accent },
  btnDanger: { backgroundColor: t.danger },
  btnText: { color: t.accentText, fontWeight: '600', fontSize: 13 },
  btnGhost: { paddingHorizontal: 8, paddingVertical: 9, backgroundColor: t.surfaceAlt },
  btnGhostText: { color: t.textDim, fontSize: 13 },
  sheetWrap: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '80%',
  },
  sheetTitle: { color: t.text, fontSize: 15, fontWeight: '600' },
  sheetHint: { color: t.textDim, fontSize: 11, marginTop: 4, marginBottom: 10 },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.border,
  },
  fileName: { color: t.textMid, fontSize: 13 },
  fileSize: { color: t.textDim, fontSize: 11, marginTop: 2 },
});
