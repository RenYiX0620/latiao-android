import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MODEL_CATALOG, type ModelEntry } from '../models/catalog';
import {
  deleteModel,
  downloadModel,
  isDownloaded,
  localPathFor,
} from '../models/download';

type RowState = { downloaded: boolean; pct: number; busy: boolean; error?: string };

export type ModelScreenProps = {
  /** 选中后把本地路径交给聊天页加载 */
  onPick: (path: string) => void;
  currentPath?: string;
};

export default function ModelScreen({ onPick, currentPath }: ModelScreenProps) {
  const [state, setState] = useState<Record<string, RowState>>({});

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

  useEffect(() => {
    refresh();
  }, [refresh]);

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
    <FlatList
      style={styles.root}
      data={MODEL_CATALOG}
      keyExtractor={m => m.id}
      renderItem={renderItem}
      contentContainerStyle={{ padding: 12 }}
      ListHeaderComponent={<Text style={styles.hint}>从 Hugging Face 下载 GGUF，全部存本机 App 沙箱</Text>}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e0e10' },
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
  progress: { color: '#8ab4af', fontSize: 12, marginTop: 6 },
  error: { color: '#e07a7a', fontSize: 12, marginTop: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, minWidth: 56, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#2f6f6a' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  btnGhost: { paddingHorizontal: 8, paddingVertical: 9 },
  btnGhostText: { color: '#888', fontSize: 13 },
});
