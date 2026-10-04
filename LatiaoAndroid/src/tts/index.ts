import Tts, { type TtsError } from 'react-native-tts';

/**
 * 朗读（TTS）—— 框架先行：
 * 这一层只定义「能不能读 / 读一段 / 停下来」的契约，底下挂的是**系统 TTS**（Android 自带引擎）。
 * 以后要换本地神经 TTS（Kokoro 那类），实现同一个接口即可，界面不用动。
 *
 * 降级契约（对齐桌面版）：拿不到引擎或没有对应语言的语音时，不静默失败——
 * 返回 { ok:false, reason, nextSteps }，界面原样显示，用户知道该去装什么。
 */

export type AppLang = 'zh' | 'en';

export type TtsStatus =
  | { available: true; lang: string; engine: string }
  | { available: false; reason: string; nextSteps: string };

export type SpeakResult = { ok: true; chunks: number } | { ok: false; reason: string; nextSteps: string };

/** 界面语言 → 语音语言 */
export function speechLangFor(lang: AppLang): string {
  return lang === 'en' ? 'en-US' : 'zh-CN';
}

/** 去掉不该念出来的东西：图片/附件标记、纯符号行 */
export function prepareText(text: string): string {
  return text
    .split('\n')
    .filter(line => !/^【(图片|附件)[：:]?[^】]*】/.test(line.trim()))
    .join('\n')
    .replace(/[·•]{2,}/g, ' ')
    .trim();
}

/**
 * 切句：TTS 引擎对几千字的文本会哑火或直接截断，按句子切成片段逐个入队。
 * 超长单句再按长度硬切。
 */
export function chunkForSpeech(text: string, max = 280): string[] {
  const clean = prepareText(text);
  if (!clean) {
    return [];
  }
  const sentences = clean
    .split(/(?<=[。！？!?；;\n])/)
    .map(s => s.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let buf = '';
  const push = () => {
    if (buf.trim()) {
      chunks.push(buf.trim());
    }
    buf = '';
  };
  for (const s of sentences) {
    if (s.length > max) {
      push();
      for (let i = 0; i < s.length; i += max) {
        chunks.push(s.slice(i, i + max));
      }
      continue;
    }
    if ((buf + s).length > max) {
      push();
    }
    buf += s;
  }
  push();
  return chunks;
}

function describeError(e: unknown): { reason: string; nextSteps: string } {
  const code = (e as TtsError | undefined)?.code;
  switch (code) {
    case 'no_engine':
    case 'not_installed_yet':
      return { reason: '手机上没有可用的语音引擎', nextSteps: '到系统设置 → 无障碍/语言 → 文字转语音，安装并选择引擎（如 Google 语音服务）' };
    case 'lang_not_supported':
    case 'lang_missing_data':
      return { reason: '引擎里没有这个语言的语音数据', nextSteps: '在系统「文字转语音」设置里下载中文/英文语音包' };
    default:
      return { reason: String(e), nextSteps: '检查系统「文字转语音」设置' };
  }
}

let readyLang: string | null = null;
let speaking = false;

/* ── 事件：只注册一次，用计数消解 ──────────────────────────────
 * react-native-tts 的 removeEventListener 在 RN 0.76 上会抛
 * `this.removeListener is not a function`（底层 emitter 没有该方法），
 * 所以不能按次增删监听；改成常驻监听 + 计数器：
 * 每个片段完成回调一次 tts-finish，全部完成才算这一轮「读完了」。
 */
let bound = false;
let remaining = 0;
let onDoneRef: (() => void) | null = null;
let onErrorRef: ((info: { reason: string; nextSteps: string }) => void) | null = null;

function settle(err?: unknown) {
  remaining = 0;
  speaking = false;
  const errFn = onErrorRef;
  const doneFn = onDoneRef;
  onDoneRef = null;
  onErrorRef = null;
  if (err !== undefined) {
    errFn?.(describeError(err));
  } else {
    doneFn?.();
  }
}

function bindOnce() {
  if (bound) {
    return;
  }
  bound = true;
  try {
    Tts.addEventListener('tts-finish', () => {
      remaining -= 1;
      if (remaining <= 0) {
        settle();
      }
    });
    Tts.addEventListener('tts-cancel', () => settle());
    Tts.addEventListener('tts-error', (e: unknown) => settle(e));
  } catch (e) {
    // 事件不可用也不致命：至少不抛出去（朗读仍然会念，只是没有完成回调）
    console.warn('[tts] 事件注册失败', String(e));
  }
}

/** 引擎与语音是否就绪（结果按语言缓存） */
export async function ensureTts(lang: string): Promise<TtsStatus> {
  if (readyLang === lang) {
    return { available: true, lang, engine: 'system' };
  }
  try {
    await Tts.getInitStatus();
  } catch (e) {
    return { available: false, ...describeError(e) };
  }
  try {
    const voices = await Tts.voices();
    const lower = lang.toLowerCase();
    const prefix = lower.split('-')[0];
    // 先精确匹配语言（zh-CN），没有再退到同语系（zh-*）——否则会把台湾音色当成大陆音色报出来
    const voice =
      voices.find(v => (v.language ?? '').toLowerCase() === lower) ??
      voices.find(v => (v.language ?? '').toLowerCase().startsWith(prefix));
    if (!voice) {
      return {
        available: false,
        reason: `系统语音里没有 ${lang} 的语音`,
        nextSteps: '到系统「文字转语音」设置里下载对应语言的语音包',
      };
    }
    await Tts.setDefaultLanguage(lang);
    readyLang = lang;
    return { available: true, lang, engine: voice.name ? `系统语音（${voice.name}）` : '系统语音' };
  } catch (e) {
    return { available: false, ...describeError(e) };
  }
}

export function isSpeaking(): boolean {
  return speaking;
}

/**
 * 读一段文本：切成片段依次入队；返回前不等待播完（长文播很久）。
 * onDone 在**全部片段**播完后触发一次（停止也算一次完成）。
 */
export async function speakText(
  text: string,
  opts: { lang: string; onDone?: () => void; onError?: (r: { reason: string; nextSteps: string }) => void },
): Promise<SpeakResult> {
  const chunks = chunkForSpeech(text);
  if (!chunks.length) {
    return { ok: true, chunks: 0 };
  }
  const status = await ensureTts(opts.lang);
  if (!status.available) {
    return { ok: false, reason: status.reason, nextSteps: status.nextSteps };
  }
  bindOnce();
  try {
    for (const c of chunks) {
      Tts.speak(c);
    }
  } catch (e) {
    settle(e);
    return { ok: false, ...describeError(e) };
  }
  remaining = chunks.length;
  speaking = true;
  onDoneRef = opts.onDone ?? null;
  onErrorRef = opts.onError ?? null;
  return { ok: true, chunks: chunks.length };
}

export async function stopSpeaking(): Promise<void> {
  speaking = false;
  remaining = 0;
  try {
    await Tts.stop();
  } catch {
    /* 没在播就无所谓 */
  }
}
