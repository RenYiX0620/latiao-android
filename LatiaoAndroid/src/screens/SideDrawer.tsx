import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import {
  loadSessions,
  newSession,
  saveSessions,
  sessionToMarkdown,
  type Session,
} from '../store/prefs';

/**
 * 侧边抽屉 —— 对标 PocketPal：导航 + 历史会话列表 + 新建会话。
 */

export type DrawerNav = 'chat' | 'models' | 'settings';

export type SideDrawerProps = {
  visible: boolean;
  onClose: () => void;
  nav: DrawerNav;
  onNav: (n: DrawerNav) => void;
  activeSessionId: string;
  onPickSession: (s: Session) => void;
  onNewSession: (s: Session) => void;
};

const NAV_ITEMS: { key: DrawerNav; label: string; icon: string }[] = [
  { key: 'chat', label: '聊天', icon: '💬' },
  { key: 'models', label: '模型', icon: '🧩' },
  { key: 'settings', label: '设置', icon: '⚙️' },
];

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function SideDrawer({
  visible,
  onClose,
  nav,
  onNav,
  activeSessionId,
  onPickSession,
  onNewSession,
}: SideDrawerProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  useEffect(() => {
    if (visible) {
      loadSessions().then(f => setSessions(f.sessions));
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* 阻止冒泡：点抽屉内部不关闭 */}
        <Pressable style={styles.panel} onPress={() => undefined}>
          <ScrollView>
            {NAV_ITEMS.map(item => (
              <Pressable
                key={item.key}
                style={[styles.navRow, nav === item.key && styles.navRowActive]}
                onPress={() => {
                  onNav(item.key);
                  onClose();
                }}
              >
                <Text style={styles.navIcon}>{item.icon}</Text>
                <Text style={styles.navLabel}>{item.label}</Text>
              </Pressable>
            ))}

            <Pressable
              style={styles.newBtn}
              onPress={() => {
                const s = newSession();
                onNewSession(s);
                onClose();
              }}
            >
              <Text style={styles.newBtnText}>＋ 新建会话</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>历史</Text>
            {sessions.length === 0 && (
              <Text style={styles.emptyHistory}>暂无历史会话</Text>
            )}
            {sessions.map(s => (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Pressable
                  style={[styles.sessionRow, s.id === activeSessionId && styles.sessionRowActive, { flex: 1 }]}
                  onPress={() => {
                    onPickSession(s);
                    onClose();
                  }}
                  onLongPress={() => {
                    Alert.alert(s.title || '未命名', '会话操作', [
                      {
                        text: '重命名',
                        onPress: () => {
                          setRenameText(s.title || '');
                          setRenameId(s.id);
                        },
                      },
                      {
                        text: '删除',
                        style: 'destructive',
                        onPress: async () => {
                          const f = await loadSessions();
                          const next = {
                            ...f,
                            sessions: f.sessions.filter(x => x.id !== s.id),
                          };
                          await saveSessions(next);
                          setSessions(next.sessions);
                        },
                      },
                      { text: '取消', style: 'cancel' },
                    ]);
                  }}
                >
                  <Text style={styles.sessionTitle} numberOfLines={1}>
                    {s.pinned ? '📌 ' : ''}
                    {s.title || '未命名'}
                  </Text>
                  <Text style={styles.sessionTime}>{fmtTime(s.ts)}</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    const f = await loadSessions();
                    const next = {
                      ...f,
                      sessions: f.sessions.map(x =>
                        x.id === s.id ? { ...x, pinned: !x.pinned } : x,
                      ),
                    };
                    // 置顶排前
                    next.sessions.sort((a, b) =>
                      b.pinned === a.pinned ? b.ts - a.ts : b.pinned ? 1 : -1,
                    );
                    await saveSessions(next);
                    setSessions(next.sessions);
                  }}
                >
                  <Text style={styles.pinBtn}>{s.pinned ? '📌' : '☆'}</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    const md = sessionToMarkdown(s);
                    const path = `${RNFS.DocumentDirectoryPath}/export-${s.id}.md`;
                    await RNFS.writeFile(path, md, 'utf8');
                    Alert.alert('已导出', path);
                  }}
                >
                  <Text style={styles.pinBtn}>⬇</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>

      <Modal visible={!!renameId} transparent animationType="fade">
        <View style={styles.renameWrap}>
          <View style={styles.renameCard}>
            <Text style={styles.renameTitle}>重命名会话</Text>
            <TextInput
              style={styles.renameInput}
              value={renameText}
              onChangeText={setRenameText}
              placeholder="会话标题"
              placeholderTextColor="#666"
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable
                style={[styles.renameBtn, { backgroundColor: '#2a2a2e' }]}
                onPress={() => setRenameId(null)}
              >
                <Text style={styles.renameBtnText}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.renameBtn, { backgroundColor: '#2f6f6a' }]}
                onPress={async () => {
                  if (!renameId) return;
                  const f = await loadSessions();
                  const next = {
                    ...f,
                    sessions: f.sessions.map(x =>
                      x.id === renameId ? { ...x, title: renameText || x.title } : x,
                    ),
                  };
                  await saveSessions(next);
                  setSessions(next.sessions);
                  setRenameId(null);
                }}
              >
                <Text style={styles.renameBtnText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', flexDirection: 'row' },
  panel: {
    width: '78%',
    maxWidth: 340,
    backgroundColor: '#161618',
    paddingTop: 56,
    paddingBottom: 24,
    paddingHorizontal: 12,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  navRowActive: { backgroundColor: '#222226' },
  navIcon: { fontSize: 18 },
  navLabel: { color: '#eee', fontSize: 15 },
  newBtn: {
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: '#2f6f6a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  newBtnText: { color: '#fff', fontWeight: '600' },
  sectionTitle: {
    color: '#777',
    fontSize: 12,
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
  },
  emptyHistory: { color: '#555', fontSize: 13, paddingHorizontal: 12 },
  sessionRow: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 8,
  },
  sessionRowActive: { backgroundColor: '#222226' },
  sessionTitle: { color: '#ddd', fontSize: 14 },
  sessionTime: { color: '#666', fontSize: 11, marginTop: 3 },
  pinBtn: { color: '#8ab4af', fontSize: 15, paddingHorizontal: 6, paddingVertical: 10 },
  renameWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  renameCard: {
    backgroundColor: '#1c1c20',
    borderRadius: 14,
    padding: 20,
    width: '82%',
    maxWidth: 320,
  },
  renameTitle: { color: '#eee', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  renameInput: {
    backgroundColor: '#2a2a2e',
    borderRadius: 8,
    padding: 12,
    color: '#eee',
  },
  renameBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  renameBtnText: { color: '#fff', fontWeight: '600' },
});
