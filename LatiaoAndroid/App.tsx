import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import ChatScreen from './src/screens/ChatScreen';
import ModelScreen from './src/screens/ModelScreen';

type Tab = 'chat' | 'models';

function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('chat');
  const [modelPath, setModelPath] = useState('');

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {tab === 'chat' ? (
          <ChatScreen modelPath={modelPath} onPickModels={() => setTab('models')} />
        ) : (
          <ModelScreen
            currentPath={modelPath}
            onPick={p => {
              setModelPath(p);
              setTab('chat');
            }}
          />
        )}
      </View>
      <View style={styles.tabbar}>
        <Pressable style={[styles.tab, tab === 'chat' && styles.tabActive]} onPress={() => setTab('chat')}>
          <Text style={[styles.tabText, tab === 'chat' && styles.tabTextActive]}>对话</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === 'models' && styles.tabActive]} onPress={() => setTab('models')}>
          <Text style={[styles.tabText, tab === 'models' && styles.tabTextActive]}>模型</Text>
        </Pressable>
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
