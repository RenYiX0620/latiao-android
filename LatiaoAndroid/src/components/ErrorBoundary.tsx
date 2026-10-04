import { Component, useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, type Theme } from '../theme';
import { useT } from '../i18n';

/**
 * 兜底错误边界：单点渲染异常不再整屏红/闪退，还能看到原始错误。
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.warn('[ErrorBoundary]', String(error), info);
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return <ErrorView error={error} onRetry={() => this.setState({ error: null })} />;
  }
}

/** 单独的函数组件，方便用主题（类组件用不了 hook） */
function ErrorView({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const i18n = useT();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{i18n('error.title')}</Text>
      <Text style={styles.body}>{String(error)}</Text>
      <Pressable style={styles.btn} onPress={onRetry}>
        <Text style={styles.btnText}>{i18n('common.retry')}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      backgroundColor: t.bg,
    },
    title: { color: t.dangerText, fontSize: 16, fontWeight: '700', marginBottom: 10 },
    body: { color: t.textMid, fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 18 },
    btn: {
      backgroundColor: t.accent,
      borderRadius: 10,
      paddingVertical: 12,
      paddingHorizontal: 28,
    },
    btnText: { color: t.accentText, fontWeight: '600' },
  });
