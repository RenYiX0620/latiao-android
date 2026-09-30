import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
});
