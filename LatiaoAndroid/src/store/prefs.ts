import RNFS from 'react-native-fs';

/**
 * 轻量偏好与历史存储 —— 用 RNFS JSON 文件（零新增原生依赖）。
 * 路径都在 App 沙箱：files/prefs.json、files/history.json。
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
  nGpuLayers: 4,
  nCtx: 4096,
  systemPrompt: '你是辣条 Latiao 的手机版，中文回复，简洁。',
};

export type ChatMsg = { role: 'user' | 'assistant'; content: string; ts?: number };

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    const p = `${BASE}/${name}`;
    if (await RNFS.exists(p)) {
      const raw = await RNFS.readFile(p, 'utf8');
      return JSON.parse(raw) as T;
    }
  } catch {
    /* 损坏则用默认 */
  }
  return fallback;
}

async function writeJson(name: string, data: unknown): Promise<void> {
  const p = `${BASE}/${name}`;
  await RNFS.writeFile(p, JSON.stringify(data), 'utf8');
}

export async function loadPrefs(): Promise<Prefs> {
  const p = await readJson<Partial<Prefs>>('prefs.json', {});
  return { ...DEFAULT_PREFS, ...p };
}

export async function savePrefs(p: Prefs): Promise<void> {
  await writeJson('prefs.json', p);
}

export async function loadHistory(): Promise<ChatMsg[]> {
  return readJson<ChatMsg[]>('history.json', []);
}

export async function saveHistory(msgs: ChatMsg[]): Promise<void> {
  // 只留最近 200 条，防文件无限涨
  await writeJson('history.json', msgs.slice(-200));
}

export async function clearHistory(): Promise<void> {
  await writeJson('history.json', []);
}

// ── 多会话历史（对齐 PocketPal 侧栏会话列表）────────────────────
export type Session = {
  id: string;
  title: string;
  ts: number;
  messages: ChatMsg[];
  pinned?: boolean;
};

type SessionsFile = { sessions: Session[]; activeId: string };

export async function loadSessions(): Promise<SessionsFile> {
  const f = await readJson<SessionsFile>('sessions.json', {
    sessions: [],
    activeId: '',
  });
  return f;
}

export async function saveSessions(f: SessionsFile): Promise<void> {
  // 限制 30 个会话，每会话 100 条
  const sessions = f.sessions.slice(0, 30).map(s => ({
    ...s,
    messages: s.messages.slice(-100),
  }));
  await writeJson('sessions.json', { sessions, activeId: f.activeId });
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

// ── 扩展：线程 / 联网搜索 / Pals 人设 ─────────────────────────
export type Pal = {
  id: string;
  name: string;
  systemPrompt: string;
};

export type PrefsExt = Prefs & {
  nThreads: number;
  /** none | tavily | brave */
  searchProvider: 'none' | 'tavily' | 'brave';
  searchApiKey: string;
  pals: Pal[];
  activePalId: string;
  /** 是否已看过首次引导 */
  onboarded: boolean;
};

export const DEFAULT_PREFS_EXT: PrefsExt = {
  ...DEFAULT_PREFS,
  nThreads: 2,
  searchProvider: 'none',
  searchApiKey: '',
  pals: [],
  activePalId: '',
  onboarded: false,
};

export async function loadPrefsExt(): Promise<PrefsExt> {
  const p = await readJson<Partial<PrefsExt>>('prefs.json', {});
  return { ...DEFAULT_PREFS_EXT, ...p };
}

export async function savePrefsExt(p: PrefsExt): Promise<void> {
  await writeJson('prefs.json', p);
}

/** 导出单个会话为 Markdown */
export function sessionToMarkdown(s: Session): string {
  const lines: string[] = [`# ${s.title || '未命名'}`, '', `> ${new Date(s.ts).toLocaleString()}`, ''];
  for (const m of s.messages) {
    lines.push(m.role === 'user' ? `## 你` : `## 助手`, '', m.content, '');
  }
  return lines.join('\n');
}
