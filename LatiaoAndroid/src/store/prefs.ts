import RNFS from 'react-native-fs';
import { makeT } from '../i18n';

/**
 * 偏好与会话存储 —— JSON 文件（零新增原生依赖）。
 *
 * 2026-10-04 加固：
 * - 所有写入走「先写 .tmp 再 rename」，避免半截写把文件写坏
 * - 读取失败不再静默用默认值覆盖，而是把损坏文件改名留档（lastIssue 上报 UI）
 * - 会话增删改一律「读盘 → 改 → 写盘」并返回新状态，杜绝内存旧副本回写造成的
 *   改名被撤销 / 置顶被撤销 / 删除被复活
 */

const BASE = RNFS.DocumentDirectoryPath;

export type Prefs = {
  /** 生成温度 */
  temperature: number;
  /** GPU offload 层数（llama.rn n_gpu_layers） */
  nGpuLayers: number;
  /** 上下文长度 */
  nCtx: number;
  /** 每次对话追加的系统提示词 */
  systemPrompt: string;
};

export const DEFAULT_PREFS: Prefs = {
  temperature: 0.7,
  nGpuLayers: 0,
  nCtx: 4096,
  systemPrompt: '你是辣条 Latiao 的手机版，中文回复，简洁。',
};

export type ChatMsg = {
  role: 'user' | 'assistant';
  content: string;
  ts?: number;
  /** 助手的思考过程（与正文分开存，不进上下文） */
  reasoning?: string;
  /** 该轮被用户中止 */
  interrupted?: boolean;
  /** 每轮遥测：tok/s、首字延迟、缓存命中 */
  stats?: string;
};

async function writeJson(name: string, data: unknown): Promise<void> {
  const p = `${BASE}/${name}`;
  const tmp = `${p}.tmp`;
  await RNFS.writeFile(tmp, JSON.stringify(data), 'utf8');
  try {
    await RNFS.moveFile(tmp, p);
  } catch {
    // 个别设备 renameTo 不覆盖目标 → 退化成删除后重命名
    await RNFS.unlink(p).catch(() => undefined);
    await RNFS.moveFile(tmp, p);
  }
}

/** 最近一次读取异常（供 UI 提示一次），读取即清空 */
let lastIssue: string | null = null;

export function takeLoadIssue(): string | null {
  const v = lastIssue;
  lastIssue = null;
  return v;
}

async function readJson<T>(name: string, fallback: T): Promise<T> {
  const p = `${BASE}/${name}`;
  try {
    if (!(await RNFS.exists(p))) {
      return fallback;
    }
    const raw = await RNFS.readFile(p, 'utf8');
    if (!raw.trim()) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    // 损坏：改名留档，绝不让后续写入把它覆盖掉
    const backup = `${name}.corrupt-${Date.now()}`;
    const t = makeT('zh');
    try {
      await RNFS.moveFile(p, `${BASE}/${backup}`);
      lastIssue = t('data.corrupt', { file: name, backup });
    } catch {
      lastIssue = t('data.corruptShort', { file: name });
    }
    return fallback;
  }
}

// ── 偏好 ────────────────────────────────────────────────
export type Pal = {
  id: string;
  name: string;
  systemPrompt: string;
};

/** 某个模型的专属参数（未列出的字段回落到全局值） */
export type ModelParams = Partial<{
  temperature: number;
  topP: number;
  topK: number;
  minP: number;
  penaltyRepeat: number;
  seed: number;
  nPredict: number;
  nCtx: number;
  enableThinking: boolean;
}>;

/** 模型键：用文件名（换目录/换存储位置后参数还认得同一个模型） */
export function modelKey(modelPath: string): string {
  if (!modelPath) {
    return '';
  }
  return modelPath.split('/').pop() ?? modelPath;
}

export type PrefsExt = Prefs & {
  /** 上次选用的模型路径 */
  modelPath: string;
  nThreads: number;
  /** none | tavily | brave */
  searchProvider: 'none' | 'tavily' | 'brave';
  searchApiKey: string;
  pals: Pal[];
  activePalId: string;
  /** 是否已看过首次引导 */
  onboarded: boolean;
  /** 采样参数（对标 PocketPal completionParams 的核心子集） */
  topP: number;
  topK: number;
  minP: number;
  penaltyRepeat: number;
  /** -1 = 每次随机（不可复现）；>=0 = 固定种子 */
  seed: number;
  /** 单轮最大生成 token */
  nPredict: number;
  /** 是否让模型输出思考（Qwen3 等模板支持；关掉更快也更省上下文） */
  enableThinking: boolean;
  /** 每个模型自己的参数覆盖，键 = 模型文件名 */
  modelParams: Record<string, ModelParams>;
  /** 界面主题：深色 / 浅色 / 跟随系统 */
  themeMode: 'dark' | 'light' | 'system';
  /** 界面语言（默认中文；没接系统 locale 探测，避免依赖原生模块） */
  lang: 'zh' | 'en';
};

export const DEFAULT_PREFS_EXT: PrefsExt = {
  ...DEFAULT_PREFS,
  modelPath: '',
  nThreads: 4,
  searchProvider: 'none',
  searchApiKey: '',
  pals: [],
  activePalId: '',
  onboarded: false,
  topP: 0.95,
  topK: 40,
  minP: 0.05,
  penaltyRepeat: 1.1,
  seed: -1,
  nPredict: 1024,
  enableThinking: true,
  modelParams: {},
  themeMode: 'system',
  lang: 'zh',
};

/**
 * 生效参数 = 全局值 + 当前模型的覆盖。
 * 加载模型、发送请求、上下文告警都应当走这里，别直接用全局值。
 */
export function resolveParams(prefs: PrefsExt, modelPath: string) {
  const o = (modelPath && prefs.modelParams?.[modelKey(modelPath)]) || {};
  const pick = <K extends keyof ModelParams>(k: K, fallback: number | boolean) =>
    o[k] !== undefined ? (o[k] as number | boolean) : fallback;
  return {
    temperature: pick('temperature', prefs.temperature) as number,
    topP: pick('topP', prefs.topP) as number,
    topK: pick('topK', prefs.topK) as number,
    minP: pick('minP', prefs.minP) as number,
    penaltyRepeat: pick('penaltyRepeat', prefs.penaltyRepeat) as number,
    seed: pick('seed', prefs.seed) as number,
    nPredict: pick('nPredict', prefs.nPredict) as number,
    nCtx: pick('nCtx', prefs.nCtx) as number,
    enableThinking: pick('enableThinking', prefs.enableThinking) as boolean,
    nThreads: prefs.nThreads,
    nGpuLayers: prefs.nGpuLayers,
  };
}

export async function loadPrefsExt(): Promise<PrefsExt> {
  const p = await readJson<Partial<PrefsExt>>('prefs.json', {});
  const merged = { ...DEFAULT_PREFS_EXT, ...p };
  // 结构兜底：损坏或旧版本写下的非数组/非对象会让下游直接崩
  if (!Array.isArray(merged.pals)) {
    merged.pals = [];
  }
  if (!merged.modelParams || typeof merged.modelParams !== 'object' || Array.isArray(merged.modelParams)) {
    merged.modelParams = {};
  }
  return merged;
}

export async function savePrefsExt(p: PrefsExt): Promise<void> {
  await writeJson('prefs.json', p);
}

// ── 会话 ────────────────────────────────────────────────
export type Session = {
  id: string;
  title: string;
  ts: number;
  messages: ChatMsg[];
  pinned?: boolean;
};

export type SessionsFile = { sessions: Session[]; activeId: string };

const MAX_SESSIONS = 30;
const MAX_MESSAGES = 300;

export async function loadSessions(): Promise<SessionsFile> {
  const f = await readJson<SessionsFile>('sessions.json', { sessions: [], activeId: '' });
  return {
    sessions: Array.isArray(f.sessions) ? f.sessions.filter(s => s && s.id) : [],
    activeId: typeof f.activeId === 'string' ? f.activeId : '',
  };
}

/** 排序 + 限量，并保证「当前会话」不会被裁掉 */
function normalize(f: SessionsFile): SessionsFile {
  const sorted = [...f.sessions].sort(
    (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.ts - a.ts,
  );
  let kept = sorted.slice(0, MAX_SESSIONS);
  if (f.activeId && !kept.some(s => s.id === f.activeId)) {
    const active = sorted.find(s => s.id === f.activeId);
    if (active) {
      kept = [...kept.slice(0, MAX_SESSIONS - 1), active];
    }
  }
  return {
    activeId: f.activeId,
    sessions: kept.map(s => ({
      ...s,
      messages: Array.isArray(s.messages) ? s.messages.slice(-MAX_MESSAGES) : [],
    })),
  };
}

async function mutateSessions(
  fn: (f: SessionsFile) => SessionsFile,
): Promise<SessionsFile> {
  const file = await loadSessions();
  const next = normalize(fn(file));
  await writeJson('sessions.json', next);
  return next;
}

export async function renameSession(id: string, title: string): Promise<SessionsFile> {
  return mutateSessions(f => ({
    ...f,
    sessions: f.sessions.map(s => (s.id === id ? { ...s, title } : s)),
  }));
}

export async function setSessionPinned(id: string, pinned: boolean): Promise<SessionsFile> {
  return mutateSessions(f => ({
    ...f,
    sessions: f.sessions.map(s => (s.id === id ? { ...s, pinned } : s)),
  }));
}

export async function deleteSession(id: string): Promise<SessionsFile> {
  return mutateSessions(f => ({
    activeId: f.activeId === id ? '' : f.activeId,
    sessions: f.sessions.filter(s => s.id !== id),
  }));
}

export async function deleteAllSessions(): Promise<SessionsFile> {
  return mutateSessions(() => ({ sessions: [], activeId: '' }));
}

/** 从首条用户消息推标题 */
export function autoTitle(messages: ChatMsg[]): string {
  const first = messages.find(m => m.role === 'user' && m.content.trim());
  return (first?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 24) || '新对话';
}

/**
 * 把 UI 消息整理成落库形态：
 * - 仍在流式的丢弃（半截内容不进历史）
 * - 正文为空但被用户停止的要保留（它带着思考与「已停止」标记）
 */
export function toPersistable(
  msgs: Array<ChatMsg & { streaming?: boolean }>,
): ChatMsg[] {
  return msgs
    .filter(m => !m.streaming && (m.content || m.interrupted))
    .map(m => ({
      role: m.role,
      content: m.content,
      ts: m.ts ?? Date.now(),
      reasoning: m.reasoning,
      interrupted: m.interrupted,
      stats: m.stats,
    }));
}

/**
 * 写入某会话的消息（唯一的会话内容写入口）。
 * 语义：只更新 messages / ts；标题只在「盘上还是占位标题」时才自动起；
 * pinned 一律以盘上为准 —— 用户刚做的改名/置顶不会被回滚。
 * 返回 null 表示该会话已不存在（用户删掉了），调用方不得复活它。
 */
export async function persistSessionMessages(
  id: string,
  messages: ChatMsg[],
): Promise<{ file: SessionsFile; session: Session | null }> {
  const file = await loadSessions();
  const found = file.sessions.find(s => s.id === id);
  if (!found) {
    console.log(`[sessions] persist 找不到会话 ${id}（盘上有 ${file.sessions.length} 个）`);
    return { file, session: null };
  }
  const placeholder = !found.title || found.title === '新对话';
  const updated: Session = {
    ...found,
    messages,
    ts: Date.now(),
    title: placeholder ? autoTitle(messages) : found.title,
  };
  const next = await mutateSessions(f => ({
    activeId: f.activeId || id,
    sessions: f.sessions.some(s => s.id === id)
      ? f.sessions.map(s => (s.id === id ? updated : s))
      : f.sessions,
  }));
  return { file: next, session: next.sessions.find(s => s.id === id) ?? null };
}

export function newSession(): Session {
  return {
    id: `s-${Date.now()}`,
    title: '新对话',
    ts: Date.now(),
    messages: [],
    pinned: false,
  };
}

/** 导出单个会话为 Markdown */
export function sessionToMarkdown(s: Session): string {
  const lines: string[] = [`# ${s.title || '未命名'}`, '', `> ${new Date(s.ts).toLocaleString()}`, ''];
  for (const m of s.messages) {
    lines.push(m.role === 'user' ? '## 你' : '## 助手', '', m.content, '');
    if (m.reasoning) {
      lines.push('<details><summary>思考过程</summary>', '', m.reasoning, '', '</details>', '');
    }
  }
  return lines.join('\n');
}
