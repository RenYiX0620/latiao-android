import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import ChatScreen from './src/screens/ChatScreen';
import ModelScreen from './src/screens/ModelScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import SideDrawer, { type DrawerNav } from './src/screens/SideDrawer';
import Onboarding from './src/screens/Onboarding';
import {
  loadPrefsExt,
  loadSessions,
  newSession,
  savePrefsExt,
  type Session,
} from './src/store/prefs';

/**
 * 导航改为「抽屉 + 历史会话」（对标 PocketPal），不再是底部 tab。
 */

function App(): JSX.Element {
  const [nav, setNav] = useState<DrawerNav>('chat');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modelPath, setModelPath] = useState('');
  const [prefsVersion, setPrefsVersion] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [onboarding, setOnboarding] = useState(false);

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
      const f = await loadSessions();
      if (f.activeId) {
        const found = f.sessions.find(s => s.id === f.activeId);
        if (found) {
          setSession(found);
          return;
        }
      }
      if (f.sessions.length > 0) {
        setSession(f.sessions[0]);
        return;
      }
      setSession(newSession());
    })();
  }, []);

  const onNewSession = useCallback((s: Session) => {
    setSession(s);
    setNav('chat');
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {nav === 'chat' && (
          <ChatScreen
            modelPath={modelPath}
            onPickModels={() => setNav('models')}
            onOpenDrawer={() => setDrawerOpen(true)}
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
            onOpenDrawer={() => setDrawerOpen(true)}
            onSaved={() => setPrefsVersion(v => v + 1)}
          />
        )}
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e0e10', paddingTop: Platform.OS === 'android' ? 28 : 44 },
  body: { flex: 1 },
});

export default App;
