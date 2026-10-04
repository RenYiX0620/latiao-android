import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, type Theme } from '../theme';
import { useT, type MsgKey } from '../i18n';

/**
 * 首次引导（简版，对标 PocketPal Onboarding）—— 三步：
 * 欢迎 → 下载模型 → 开始聊天。只在 onboarded=false 时弹出。
 */

const STEPS: { icon: string; title: MsgKey; body: MsgKey }[] = [
  {
    icon: '🛸',
    title: 'onboarding.s1.title',
    body: 'onboarding.s1.body',
  },
  {
    icon: '📦',
    title: 'onboarding.s2.title',
    body: 'onboarding.s2.body',
  },
  {
    icon: '💬',
    title: 'onboarding.s3.title',
    body: 'onboarding.s3.body',
  },
];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const i18n = useT();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <Text style={styles.icon}>{s.icon}</Text>
          <Text style={styles.title}>{i18n(s.title)}</Text>
          <Text style={styles.body}>{i18n(s.body)}</Text>
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
              {step < STEPS.length - 1 ? i18n('onboarding.next') : i18n('onboarding.start')}
            </Text>
          </Pressable>
          {step > 0 && (
            <Pressable onPress={() => setStep(step - 1)}>
              <Text style={styles.back}>{i18n('onboarding.back')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: t.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    backgroundColor: t.surface,
    borderRadius: 18,
    padding: 28,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  icon: { fontSize: 56, marginBottom: 16 },
  title: { color: t.text, fontSize: 19, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  body: { color: t.textDim, fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  dots: { flexDirection: 'row', gap: 6, marginBottom: 18 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: t.switchOff },
  dotOn: { backgroundColor: t.accent, width: 18 },
  btn: {
    backgroundColor: t.accent,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 40,
    width: '100%',
    alignItems: 'center',
  },
  btnText: { color: t.accentText, fontWeight: '600', fontSize: 15 },
  back: { color: t.textDim, marginTop: 12, fontSize: 13 },
});
