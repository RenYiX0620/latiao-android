import { useEffect, useState, useMemo } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import {
  deleteSession,
  loadSessions,
  newSession,
  renameSession,
  sessionToMarkdown,
  setSessionPinned,
  type Session,
} from '../store/prefs';
import { useTheme, type Theme } from '../theme';
import { useT, type MsgKey } from '../i18n';

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
  /** 改名/置顶/删除之后通知外层重新同步（否则内存旧副本会把操作覆盖回去） */
  onSessionsChanged?: () => void | Promise<void>;
};

const NAV_ITEMS: { key: DrawerNav; label: MsgKey; icon: string }[] = [
  { key: 'chat', label: 'nav.chat', icon: '💬' },
  { key: 'models', label: 'nav.models', icon: '🧩' },
  { key: 'settings', label: 'nav.settings', icon: '⚙️' },
];

function fmtTime(ts: number, t: (k: MsgKey, p?: Record<string, string | number>) => string): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return t('drawer.dateShort', { m: d.getMonth() + 1, d: d.getDate() });
}

export default function SideDrawer({
  visible,
  onClose,
  nav,
  onNav,
  activeSessionId,
  onPickSession,
  onNewSession,
  onSessionsChanged,
}: SideDrawerProps) {
    const i18n = useT();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
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
                <Text style={styles.navLabel}>{i18n(item.label)}</Text>
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
              <Text style={styles.newBtnText}>{i18n('drawer.new')}</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>{i18n('drawer.history')}</Text>
            {sessions.length === 0 && (
              <Text style={styles.emptyHistory}>{i18n('drawer.noHistory')}</Text>
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
                    Alert.alert(s.title || i18n('common.unnamed'), i18n('drawer.sessionActions'), [
                      {
                        text: i18n('common.rename'),
                        onPress: () => {
                          setRenameText(s.title || '');
                          setRenameId(s.id);
                        },
                      },
                      {
                        text: i18n('common.delete'),
                        style: 'destructive',
                        onPress: () => {
                          Alert.alert(
                            i18n('drawer.deleteTitle'),
                            i18n('drawer.deleteConfirm', { title: s.title || i18n('common.unnamed') }),
                            [
                              { text: i18n('common.cancel'), style: 'cancel' },
                              {
                                text: i18n('common.delete'),
                                style: 'destructive',
                                onPress: async () => {
                                  const next = await deleteSession(s.id);
                                  setSessions(next.sessions);
                                  await onSessionsChanged?.();
                                },
                              },
                            ],
                          );
                        },
                      },
                      { text: i18n('common.cancel'), style: 'cancel' },
                    ]);
                  }}
                >
                  <Text style={styles.sessionTitle} numberOfLines={1}>
                    {s.pinned ? '📌 ' : ''}
                    {s.title || i18n('common.unnamed')}
                  </Text>
                  <Text style={styles.sessionTime}>{fmtTime(s.ts, i18n)}</Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    const next = await setSessionPinned(s.id, !s.pinned);
                    setSessions(next.sessions);
                    await onSessionsChanged?.();
                  }}
                >
                  <Text style={styles.pinBtn}>{s.pinned ? '📌' : '☆'}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const md = sessionToMarkdown(s);
                    Alert.alert(i18n('drawer.exportTitle'), i18n('drawer.exportHint'), [
                      {
                        text: i18n('drawer.exportShare'),
                        onPress: async () => {
                          try {
                            await Share.share({ message: md, title: s.title || i18n('drawer.exportSubject') });
                          } catch {
                            /* 用户取消 */
                          }
                        },
                      },
                      {
                        text: i18n('drawer.exportWrite'),
                        onPress: async () => {
                          const path = `${RNFS.DocumentDirectoryPath}/export-${s.id}.md`;
                          await RNFS.writeFile(path, md, 'utf8');
                          Alert.alert(i18n('drawer.exported'), path);
                        },
                      },
                      { text: i18n('common.cancel'), style: 'cancel' },
                    ]);
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
            <Text style={styles.renameTitle}>{i18n('drawer.renameTitle')}</Text>
            <TextInput
              style={styles.renameInput}
              value={renameText}
              onChangeText={setRenameText}
              placeholder={i18n('drawer.sessionTitlePlaceholder')}
              placeholderTextColor={t.textDim}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable
                style={[styles.renameBtn, { backgroundColor: t.surfaceAlt }]}
                onPress={() => setRenameId(null)}
              >
                <Text style={styles.renameBtnText}>{i18n('common.cancel')}</Text>
              </Pressable>
              <Pressable
                style={[styles.renameBtn, { backgroundColor: t.accent }]}
                onPress={async () => {
                  if (!renameId) return;
                  const next = await renameSession(renameId, renameText.trim());
                  setSessions(next.sessions);
                  await onSessionsChanged?.();
                  setRenameId(null);
                }}
              >
                <Text style={styles.renameBtnText}>{i18n('common.save')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: t.scrim, flexDirection: 'row' },
  panel: {
    width: '78%',
    maxWidth: 340,
    backgroundColor: t.surface,
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
  navRowActive: { backgroundColor: t.surfaceAlt },
  navIcon: { fontSize: 18 },
  navLabel: { color: t.text, fontSize: 15 },
  newBtn: {
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: t.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  newBtnText: { color: t.accentText, fontWeight: '600' },
  sectionTitle: {
    color: t.textDim,
    fontSize: 12,
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
  },
  emptyHistory: { color: t.textFaint, fontSize: 13, paddingHorizontal: 12 },
  sessionRow: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 8,
  },
  sessionRowActive: { backgroundColor: t.surfaceAlt },
  sessionTitle: { color: t.textMid, fontSize: 14 },
  sessionTime: { color: t.textFaint, fontSize: 11, marginTop: 3 },
  pinBtn: { color: t.accentSoft, fontSize: 15, paddingHorizontal: 6, paddingVertical: 10 },
  renameWrap: {
    flex: 1,
    backgroundColor: t.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  renameCard: {
    backgroundColor: t.surface,
    borderRadius: 14,
    padding: 20,
    width: '82%',
    maxWidth: 320,
  },
  renameTitle: { color: t.text, fontSize: 16, fontWeight: '600', marginBottom: 12 },
  renameInput: {
    backgroundColor: t.surfaceAlt,
    borderRadius: 8,
    padding: 12,
    color: t.text,
  },
  renameBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  renameBtnText: { color: t.accentText, fontWeight: '600' },
});
