/**
 * 文案层（i18n）—— zh 是源，en 必须与之 key 完全对齐（有单测把关）。
 * 用法：`const t = useT();  t('settings.title')`，插值用 `t('x.y', {n: 3})` 配 `{n}`。
 * 缺 key 时的行为：回退到 zh；再缺就把 key 原样显出来并在控制台告警——漏翻一眼就能发现。
 * 不翻译的东西：工具描述与工具输出（是给模型看的提示词侧内容）、开发者日志。
 */
import React, { createContext, useContext, useMemo } from 'react';
import { zh, type MsgKey } from './zh';
import { en } from './en';

export type Lang = 'zh' | 'en';

const dicts: Record<Lang, Record<string, string>> = { zh, en };

export type TFn = (key: MsgKey, params?: Record<string, string | number>) => string;

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] === undefined ? `{${k}}` : String(params[k]),
  );
}

export function makeT(lang: Lang): TFn {
  const primary = dicts[lang] ?? dicts.zh;
  return (key, params) => {
    const raw = primary[key] ?? dicts.zh[key];
    if (raw === undefined) {
      console.warn(`[i18n] 缺文案：${key}`);
      return key;
    }
    return interpolate(raw, params);
  };
}

const I18nContext = createContext<TFn>(makeT('zh'));

export function I18nProvider({
  lang,
  children,
}: {
  lang: Lang;
  children: React.ReactNode;
}) {
  const t = useMemo(() => makeT(lang), [lang]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT(): TFn {
  return useContext(I18nContext);
}

export { zh, en };
export type { MsgKey };
