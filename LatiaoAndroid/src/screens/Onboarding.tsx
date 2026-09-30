import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * 首次引导（简版，对标 PocketPal Onboarding）—— 三步：
 * 欢迎 → 下载模型 → 开始聊天。只在 onboarded=false 时弹出。
 */

const STEPS = [
  {
    icon: '🛸',
    title: '欢迎使用辣条手机版',
    body: '本地运行 AI 模型，对话不出手机。无需账号，离线可用。',
  },
  {
    icon: '📦',
    title: '先下载一个模型',
    body: '到「模型」页从内置精选或 Hugging Face 下载 GGUF；也可以导入手机里已有的 .gguf 文件。',
  },
  {
    icon: '💬',
    title: '加载后就能聊',
    body: '点「加载」把模型装进内存，然后直接问问题、或让它用工具干活。',
  },
];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Text style={styles.icon}>{s.icon}</Text>
          <Text style={styles.title}>{s.title}</Text>
          <Text style={styles.body}>{s.body}</Text>
          <View style={styles.dots}>
            {STEPS.map((_, i) => (
              <View key={i} style={[styles.dot, i === step && styles.dotOn]} />
            ))}
          </View>
          <Pressable
            style={styles.btn}
            onPress={() => {
              if (step < STEPS.length - 1) {
                setStep(step + 1);
              } else {
                onDone();
              }
            }}
          >
            <Text style={styles.btnText}>
              {step < STEPS.length - 1 ? '下一步' : '开始使用'}
            </Text>
          </Pressable>
          {step > 0 && (
            <Pressable onPress={() => setStep(step - 1)}>
              <Text style={styles.back}>返回</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    backgroundColor: '#1a1a1e',
    borderRadius: 18,
    padding: 28,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  icon: { fontSize: 56, marginBottom: 16 },
  title: { color: '#eee', fontSize: 19, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  body: { color: '#aaa', fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  dots: { flexDirection: 'row', gap: 6, marginBottom: 18 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#444' },
  dotOn: { backgroundColor: '#2f6f6a', width: 18 },
  btn: {
    backgroundColor: '#2f6f6a',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 40,
    width: '100%',
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  back: { color: '#777', marginTop: 12, fontSize: 13 },
});
