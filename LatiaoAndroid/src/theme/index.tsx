import React, { createContext, useContext, useMemo } from 'react';

/**
 * 主题层：把界面颜色收成一套 token，深/浅两套调色板。
 * 迁移方式：各屏的 StyleSheet 改成 `makeStyles(t)`，组件里 `const t = useTheme()`。
 * 规则：深色 = 迁移前的原样，浅色是新加的；token 名只描述用途，不描述颜色。
 */

export type ThemeMode = 'dark' | 'light' | 'system';

export type Theme = {
  mode: 'dark' | 'light';
  /** 页面底色 */
  bg: string;
  /** 输入栏等次级底色 */
  bgAlt: string;
  /** 卡片/气泡/输入框底 */
  surface: string;
  /** 悬浮/激活态底 */
  surfaceAlt: string;
  border: string;
  /** 遮罩 */
  scrim: string;
  text: string;
  textMid: string;
  textDim: string;
  textFaint: string;
  /** 品牌主色（按钮） */
  accent: string;
  /** 主色上的文字 */
  accentText: string;
  /** 次要强调（链接/徽章文字） */
  accentSoft: string;
  bubbleUser: string;
  bubbleUserText: string;
  bubbleBot: string;
  bubbleBotText: string;
  danger: string;
  dangerBg: string;
  dangerText: string;
  warnBg: string;
  warnText: string;
  noticeBg: string;
  noticeText: string;
  /** 主行动按钮（浅底深字） */
  ctaBg: string;
  ctaText: string;
  thinkBorder: string;
  thinkText: string;
  switchOff: string;
  imageBg: string;
};

const dark: Theme = {
  mode: 'dark',
  bg: '#0e0e10',
  bgAlt: '#141416',
  surface: '#1c1c1f',
  surfaceAlt: '#222226',
  border: '#2a2a2d',
  scrim: 'rgba(0,0,0,0.6)',
  text: '#eeeeee',
  textMid: '#dddddd',
  textDim: '#999999',
  textFaint: '#777777',
  accent: '#2f6f6a',
  accentText: '#ffffff',
  accentSoft: '#8ab4af',
  bubbleUser: '#2f6f6a',
  bubbleUserText: '#ffffff',
  bubbleBot: '#1c1c1f',
  bubbleBotText: '#eeeeee',
  danger: '#8a3030',
  dangerBg: '#5a2d2d',
  dangerText: '#e07a7a',
  warnBg: '#33262a',
  warnText: '#e0a0a0',
  noticeBg: '#2a2a18',
  noticeText: '#d8c98a',
  ctaBg: '#d8d8d8',
  ctaText: '#111111',
  thinkBorder: '#3a4a48',
  thinkText: '#8f9c9a',
  switchOff: '#3a3a3e',
  imageBg: '#111111',
};

const light: Theme = {
  mode: 'light',
  bg: '#f5f5f7',
  bgAlt: '#ececef',
  surface: '#ffffff',
  surfaceAlt: '#e8e8ec',
  border: '#dcdce1',
  scrim: 'rgba(0,0,0,0.35)',
  text: '#16181a',
  textMid: '#33363a',
  textDim: '#6b7076',
  textFaint: '#9aa0a6',
  accent: '#2f6f6a',
  accentText: '#ffffff',
  accentSoft: '#2f6f6a',
  bubbleUser: '#2f6f6a',
  bubbleUserText: '#ffffff',
  bubbleBot: '#ffffff',
  bubbleBotText: '#16181a',
  danger: '#c0453f',
  dangerBg: '#f3d7d5',
  dangerText: '#b3352f',
  warnBg: '#fbeede',
  warnText: '#8a5a1f',
  noticeBg: '#eef3e0',
  noticeText: '#5c6b2f',
  ctaBg: '#2f6f6a',
  ctaText: '#ffffff',
  thinkBorder: '#c3d3d1',
  thinkText: '#5d6f6d',
  switchOff: '#c9c9cf',
  imageBg: '#e4e4e8',
};

export const themes: Record<'dark' | 'light', Theme> = { dark, light };

const ThemeContext = createContext<Theme>(dark);

export function ThemeProvider({
  mode,
  children,
}: {
  mode: 'dark' | 'light';
  children: React.ReactNode;
}) {
  const value = useMemo(() => themes[mode] ?? dark, [mode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** 按主题生成样式表（各屏统一用法） */
export function useStyles<T>(factory: (t: Theme) => T): T {
  const t = useTheme();
  return useMemo(() => factory(t), [t, factory]);
}
