import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, type Theme } from '../theme';
import { useT } from '../i18n';

/**
 * 思考过程折叠块（对标 PocketPal ThinkingBubble）：
 * - 思考流式时展开，正文一开始出现就自动收起
 * - 用户手动展开/收起后，尊重用户选择，不再自动动
 */
export default function ThinkingBlock({
  reasoning,
  streaming,
  hasContent,
}: {
  reasoning: string;
  streaming?: boolean;
  hasContent?: boolean;
}) {
  const i18n = useT();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
  const [manual, setManual] = useState<boolean | null>(null);
  const autoOpen = !!streaming && !hasContent;
  const open = manual ?? autoOpen;

  // 正文出现 → 自动收起（只在用户没手动操作过时生效）
  useEffect(() => {
    if (hasContent && manual === null) {
      setManual(false);
    }
  }, [hasContent, manual]);

  if (!reasoning) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.head}
        onPress={() => setManual(!open)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={open ? i18n('think.collapse') : i18n('think.expand')}
      >
        <Text style={styles.headText}>
          💭 {i18n('think.title')}
          {streaming && !hasContent ? i18n('think.suffix') : ''}
        </Text>
        <Text style={styles.caret}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open ? <Text style={styles.body}>{reasoning}</Text> : null}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: {
      borderLeftWidth: 2,
      borderLeftColor: t.thinkBorder,
      paddingLeft: 10,
      marginBottom: 8,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
    headText: { color: t.accentSoft, fontSize: 12, fontWeight: '600' },
    caret: { color: t.accentSoft, fontSize: 11 },
    body: { color: t.thinkText, fontSize: 13, lineHeight: 19, marginTop: 4 },
  });
