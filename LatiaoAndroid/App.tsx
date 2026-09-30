import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import ChatScreen from './src/screens/ChatScreen';
import ModelScreen from './src/screens/ModelScreen';
import SettingsScreen from './src/screens/SettingsScreen';

type Tab = 'chat' | 'models' | 'settings';

function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('chat');
  const [modelPath, setModelPath] = useState('');
  const [prefsVersion, setPrefsVersion] = useState(0);

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {tab === 'chat' && (
          <ChatScreen
            modelPath={modelPath}
            onPickModels={() => setTab('models')}
            prefsVersion={prefsVersion}
          />
        )}
        {tab === 'models' && (
          <ModelScreen
            currentPath={modelPath}
            onPick={p => {
              setModelPath(p);
              setTab('chat');
            }}
          />
        )}
        {tab === 'settings' && (
          <SettingsScreen onSaved={() => setPrefsVersion(v => v + 1)} />
        )}
      </View>
      <View style={styles.tabbar}>
        {(
          [
            ['chat', '对话'],
            ['models', '模型'],
            ['settings', '设置'],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            style={[styles.tab, tab === key && styles.tabActive]}
            onPress={() => setTab(key)}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e0e10' },
  body: { flex: 1 },
  tabbar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2a2d',
    paddingBottom: Platform.OS === 'ios' ? 8 : 8,
    backgroundColor: '#141416',
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabActive: { borderTopWidth: 2, borderTopColor: '#2f6f6a' },
  tabText: { color: '#777', fontSize: 13 },
  tabTextActive: { color: '#8ab4af', fontWeight: '600' },
});

export default App;
