/**
 * 会话存储回归 —— 固化设备上实测到的三个数据事故：
 * 1) 改名/置顶被下一条消息回滚（内存旧副本整体回写）
 * 2) 删除的会话被下一条消息复活
 * 3) 文件损坏后静默用默认值覆盖（历史永久丢失）
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import RNFS from 'react-native-fs';
import {
  DEFAULT_PREFS_EXT,
  deleteAllSessions,
  deleteSession,
  loadPrefsExt,
  loadSessions,
  modelKey,
  persistSessionMessages,
  renameSession,
  resolveParams,
  setSessionPinned,
  takeLoadIssue,
  toPersistable,
  type ChatMsg,
} from '../src/store/prefs';

const FS = (RNFS as unknown as { __fs: { seed: (p: string, c: string) => void; get: (p: string) => string | undefined; has: (p: string) => boolean; clear: () => void } }).__fs;
const SESSIONS = '/tmp/latiao-docs/sessions.json';
const PREFS = '/tmp/latiao-docs/prefs.json';

const seedSessions = (data: unknown) => FS.seed(SESSIONS, JSON.stringify(data));
const readSessions = () => JSON.parse(FS.get(SESSIONS) ?? '{}');

beforeEach(() => {
  FS.clear();
  jest.clearAllMocks();
});

describe('persistSessionMessages', () => {
  it('不会回滚用户刚做的改名与置顶', async () => {
    seedSessions({
      activeId: 's1',
      sessions: [
        { id: 's1', title: '我改过的名字', ts: 1, messages: [], pinned: true },
      ],
    });

    const { session } = await persistSessionMessages('s1', [
      { role: 'user', content: 'hi', ts: 2 } as ChatMsg,
    ]);

    const onDisk = readSessions().sessions[0];
    expect(onDisk.title).toBe('我改过的名字');
    expect(onDisk.pinned).toBe(true);
    expect(onDisk.messages).toHaveLength(1);
    expect(session?.title).toBe('我改过的名字');
  });

  it('盘上还是占位标题时才自动起名', async () => {
    seedSessions({ activeId: 's1', sessions: [{ id: 's1', title: '新对话', ts: 1, messages: [] }] });
    await persistSessionMessages('s1', [{ role: 'user', content: '帮我看看今天的行情', ts: 2 }]);
    expect(readSessions().sessions[0].title).toBe('帮我看看今天的行情');
  });

  it('已删除的会话不会被复活', async () => {
    seedSessions({ activeId: '', sessions: [] });
    const { session, file } = await persistSessionMessages('ghost', [
      { role: 'user', content: 'hi', ts: 2 },
    ]);
    expect(session).toBeNull();
    expect(file.sessions).toHaveLength(0);
    expect(readSessions().sessions).toHaveLength(0);
  });

  it('写完不留 .tmp 残留', async () => {
    seedSessions({ activeId: 's1', sessions: [{ id: 's1', title: 't', ts: 1, messages: [] }] });
    await persistSessionMessages('s1', [{ role: 'user', content: 'hi', ts: 2 }]);
    expect(FS.has(`${SESSIONS}.tmp`)).toBe(false);
  });
});

describe('会话管理', () => {
  it('删除当前会话会清空 activeId', async () => {
    seedSessions({ activeId: 's1', sessions: [{ id: 's1', title: 't', ts: 1, messages: [] }] });
    const next = await deleteSession('s1');
    expect(next.activeId).toBe('');
    expect(next.sessions).toHaveLength(0);
  });

  it('置顶会排到最前并持久化', async () => {
    seedSessions({
      activeId: 's1',
      sessions: [
        { id: 's1', title: 'a', ts: 1, messages: [] },
        { id: 's2', title: 'b', ts: 2, messages: [] },
      ],
    });
    const next = await setSessionPinned('s1', true);
    expect(next.sessions[0].id).toBe('s1');
    expect(readSessions().sessions[0].pinned).toBe(true);
  });

  it('改名写盘并返回新状态', async () => {
    seedSessions({ activeId: 's1', sessions: [{ id: 's1', title: 'a', ts: 1, messages: [] }] });
    const next = await renameSession('s1', '新名字');
    expect(next.sessions[0].title).toBe('新名字');
    expect(readSessions().sessions[0].title).toBe('新名字');
  });

  it('清空会话', async () => {
    seedSessions({ activeId: 's1', sessions: [{ id: 's1', title: 'a', ts: 1, messages: [] }] });
    await deleteAllSessions();
    expect(readSessions().sessions).toHaveLength(0);
    expect(readSessions().activeId).toBe('');
  });
});

describe('损坏与兜底', () => {
  it('损坏的 sessions.json 留档而不是静默覆盖', async () => {
    FS.seed(SESSIONS, '{这不是 JSON');
    const file = await loadSessions();
    expect(file.sessions).toHaveLength(0);
    expect(takeLoadIssue()).toMatch(/sessions\.json/);
    // 原损坏文件被移走留档，且不再占据原路径（避免下一次写入把它彻底覆盖）
    expect(FS.has(SESSIONS)).toBe(false);
    expect((RNFS as unknown as { __fs: { keys: () => string[] } }).__fs.keys().some(k => k.includes('.corrupt-'))).toBe(true);
    // 只报一次
    expect(takeLoadIssue()).toBeNull();
  });

  it('pals 不是数组时兜底为空数组（否则下游 .find 直接崩）', async () => {
    FS.seed(PREFS, JSON.stringify({ pals: 'oops', nCtx: 2048 }));
    const p = await loadPrefsExt();
    expect(p.pals).toEqual([]);
    expect(p.nCtx).toBe(2048);
  });
});

describe('模型专属参数', () => {
  it('modelKey 用文件名（换目录也认得出同一个模型）', () => {
    expect(modelKey('/sdcard/Download/models/Qwen3-0.6B-Q4_K_M.gguf')).toBe(
      'Qwen3-0.6B-Q4_K_M.gguf',
    );
    expect(modelKey('')).toBe('');
  });

  it('没有覆盖时全部跟随全局', () => {
    const p = { ...DEFAULT_PREFS_EXT, nCtx: 4096, temperature: 0.7, nPredict: 1024 };
    const rp = resolveParams(p, '/x/model-a.gguf');
    expect(rp.nCtx).toBe(4096);
    expect(rp.temperature).toBe(0.7);
    expect(rp.enableThinking).toBe(DEFAULT_PREFS_EXT.enableThinking);
  });

  it('只覆盖写了的字段，其余回落全局', () => {
    const p = {
      ...DEFAULT_PREFS_EXT,
      nCtx: 4096,
      temperature: 0.7,
      modelParams: { 'model-a.gguf': { nCtx: 32768, enableThinking: false } },
    };
    const rp = resolveParams(p, '/sdcard/model-a.gguf');
    expect(rp.nCtx).toBe(32768);
    expect(rp.enableThinking).toBe(false);
    expect(rp.temperature).toBe(0.7);
  });

  it('覆盖只对自己的模型生效', () => {
    const p = {
      ...DEFAULT_PREFS_EXT,
      nCtx: 4096,
      modelParams: { 'model-a.gguf': { nCtx: 32768 } },
    };
    expect(resolveParams(p, '/sdcard/model-b.gguf').nCtx).toBe(4096);
  });

  it('modelParams 结构损坏时兜底为空对象', async () => {
    FS.seed(PREFS, JSON.stringify({ modelParams: 'oops', pals: [] }));
    const p = await loadPrefsExt();
    expect(p.modelParams).toEqual({});
  });
});

describe('toPersistable', () => {
  it('丢弃流式中的半截，保留被停止的空消息', () => {
    const out = toPersistable([
      { role: 'user', content: 'hi', ts: 1 },
      { role: 'assistant', content: '半截', streaming: true },
      { role: 'assistant', content: '', interrupted: true, reasoning: '想了半天', ts: 2 },
      { role: 'assistant', content: '', ts: 3 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].interrupted).toBe(true);
    expect(out[1].reasoning).toBe('想了半天');
  });
});
