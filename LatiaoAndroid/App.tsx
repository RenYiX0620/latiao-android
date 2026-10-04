import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Appearance, Platform, StyleSheet, View } from 'react-native';
import ChatScreen from './src/screens/ChatScreen';
import ModelScreen from './src/screens/ModelScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import SideDrawer, { type DrawerNav } from './src/screens/SideDrawer';
import Onboarding from './src/screens/Onboarding';
import ErrorBoundary from './src/components/ErrorBoundary';
import { ThemeProvider, useTheme, type ThemeMode } from './src/theme';
import { I18nProvider, useT, type Lang } from './src/i18n';
import {
  loadPrefsExt,
  loadSessions,
  newSession,
  savePrefsExt,
  takeLoadIssue,
  type Session,
} from './src/store/prefs';

/**
 * 导航改为「抽屉 + 历史会话」（对标 PocketPal），不再是底部 tab。
 * 会话状态以磁盘为准：抽屉里的改名/置顶/删除做完后回调这里重新同步，
 * 避免内存旧副本把用户操作覆盖回去。
 * 主题：prefs.themeMode（深/浅/跟系统），系统模式下跟随 Appearance。
 */

function AppBody({
  themeMode,
  onThemeModeChange,
  lang,
  onLangChange,
}: {
  themeMode: ThemeMode;
  onThemeModeChange: (m: ThemeMode) => void;
  lang: Lang;
  onLangChange: (l: Lang) => void;
}): JSX.Element {
  const i18n = useT();
  const styles = useMemoStyles();
  const [nav, setNav] = useState<DrawerNav>('chat');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modelPath, setModelPath] = useState('');
  const [prefsVersion, setPrefsVersion] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [onboarding, setOnboarding] = useState(false);

  /** 从磁盘重新同步当前会话（会话被删就自动切走） */
  const syncFromDisk = useCallback(async () => {
    const f = await loadSessions();
    console.log(`[sessions] sync: ${f.sessions.length} chats, activeId=${f.activeId}`, takeLoadIssue() ?? '');
    const active = f.activeId ? f.sessions.find(s => s.id === f.activeId) : undefined;
    setSession(active ?? f.sessions[0] ?? newSession());
  }, []);

  // 启动：恢复上次会话，没有则建新会话；首次弹引导
  useEffect(() => {
    (async () => {
      const prefs = await loadPrefsExt();
      if (!prefs.onboarded) {
        setOnboarding(true);
      }
      if (prefs.modelPath) {
        setModelPath(prefs.modelPath);
      }
      const issue = takeLoadIssue();
      if (issue) {
        Alert.alert(i18n('data.issueTitle'), issue);
      }
      await syncFromDisk();
    })();
  }, [syncFromDisk, i18n]);

  const onNewSession = useCallback((s: Session) => {
    setSession(s);
    setNav('chat');
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        <ErrorBoundary>
          {nav === 'chat' && (
            <ChatScreen
              modelPath={modelPath}
              lang={lang}
              onPickModels={() => setNav('models')}
              onOpenDrawer={() => setDrawerOpen(true)}
              onOpenSettings={() => setNav('settings')}
              prefsVersion={prefsVersion}
              activeSession={session}
              onSessionChange={setSession}
            />
          )}
          {nav === 'models' && (
            <ModelScreen
              currentPath={modelPath}
              onOpenDrawer={() => setDrawerOpen(true)}
              onPick={p => {
                setModelPath(p);
                setNav('chat');
                loadPrefsExt()
                  .then(pref => savePrefsExt({ ...pref, modelPath: p }))
                  .catch(() => undefined);
              }}
            />
          )}
          {nav === 'settings' && (
            <SettingsScreen
              themeMode={themeMode}
              onThemeModeChange={onThemeModeChange}
              lang={lang}
              onLangChange={onLangChange}
              onOpenDrawer={() => setDrawerOpen(true)}
              onSaved={() => setPrefsVersion(v => v + 1)}
              onSessionsCleared={syncFromDisk}
            />
          )}
        </ErrorBoundary>
      </View>

      {onboarding && (
        <Onboarding
          onDone={async () => {
            setOnboarding(false);
            const prefs = await loadPrefsExt();
            await savePrefsExt({ ...prefs, onboarded: true });
          }}
        />
      )}

      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        nav={nav}
        onNav={n => setNav(n)}
        activeSessionId={session?.id ?? ''}
        onPickSession={s => {
          setSession(s);
          setNav('chat');
        }}
        onNewSession={onNewSession}
        onSessionsChanged={syncFromDisk}
      />
    </View>
  );
}

/** 主题模式下跟随系统 */
function App(): JSX.Element {
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [lang, setLang] = useState<Lang>('zh');
  const [systemScheme, setSystemScheme] = useState<string>(
    Appearance.getColorScheme() ?? 'dark',
  );

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme ?? 'dark');
    });
    loadPrefsExt()
      .then(p => {
        setThemeMode(p.themeMode ?? 'system');
        setLang(p.lang ?? 'zh');
      })
      .catch(() => undefined);
    return () => sub.remove();
  }, []);

  const mode: 'dark' | 'light' =
    themeMode === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : themeMode;

  return (
    <I18nProvider lang={lang}>
      <ThemeProvider mode={mode}>
        <AppBody
          themeMode={themeMode}
          onThemeModeChange={setThemeMode}
          lang={lang}
          onLangChange={setLang}
        />
      </ThemeProvider>
    </I18nProvider>
  );
}

/** 供 AppBody 用的样式（按主题生成） */
function useMemoStyles() {
  const t = useTheme();
  return useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: t.bg,
          paddingTop: Platform.OS === 'android' ? 28 : 44,
        },
        body: { flex: 1 },
      }),
    [t],
  );
}

export default App;
