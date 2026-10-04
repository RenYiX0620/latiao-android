/**
 * agent 循环回归 —— 把设备上撞到的三类事故固化成用例：
 * 1) 工具轮（第二轮必须能跑完，且工具结果以 tool 消息回灌）
 * 2) 中断（不得把原始文本当终答，思考要落进 reasoning）
 * 3) 失败上报（工具失败必须带 ERROR 前缀，否则模型会把失败当成功）
 */
import { describe, expect, it, jest } from '@jest/globals';
import { runAgentLoop, splitThink, type AgentMsg } from '../src/agent/loop';

type Round = { result?: Record<string, unknown>; tokens?: Array<Record<string, unknown>> };

function makeCtx(rounds: Round[]) {
  const seen: Array<Record<string, any>> = [];
  const ctx = {
    completion: jest.fn(async (params: Record<string, any>, cb?: (d: unknown) => void) => {
      seen.push(params);
      const r = rounds.shift() ?? {};
      for (const t of r.tokens ?? []) {
        cb?.(t);
      }
      return {
        text: '',
        content: '',
        reasoning_content: '',
        tool_calls: [],
        timings: { prompt_n: 100, predicted_n: 5, predicted_per_second: 25, cache_n: 3 },
        context_full: false,
        truncated: false,
        interrupted: false,
        ...(r.result ?? {}),
      };
    }),
    release: jest.fn(async () => undefined),
    stopCompletion: jest.fn(async () => undefined),
  };
  return { ctx: ctx as never, seen };
}

const USER: AgentMsg[] = [{ role: 'user', content: '现在几点' }];

describe('runAgentLoop', () => {
  it('普通一轮：返回正文并带遥测，且要求模型分离思考', async () => {
    const { ctx, seen } = makeCtx([{ result: { content: '你好' } }]);
    const res = await runAgentLoop(ctx, USER);

    expect(res.text).toBe('你好');
    expect(res.telemetry.rounds).toBe(1);
    expect(res.telemetry.tokensPerSec).toBe(25);
    expect(seen[0].reasoning_format).toBe('deepseek');
    expect(seen[0].parallel_tool_calls).toBe(false);
  });

  it('工具轮：工具结果以 tool 消息回灌，第二轮能跑完', async () => {
    const { ctx, seen } = makeCtx([
      {
        result: {
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'get_current_time', arguments: '{}' },
            },
          ],
        },
      },
      { result: { content: '现在是本地时间。' } },
    ]);
    const starts: string[] = [];
    const ends: Array<[string, boolean]> = [];
    const res = await runAgentLoop(ctx, USER, {
      onToolStart: n => starts.push(n),
      onToolEnd: (n, ok) => ends.push([n, ok]),
    });

    expect(seen).toHaveLength(2);
    // 工具轮以「文本等价形态」回灌：助手正文带 <tool_call>，结果放进 user 轮的 <tool_response>
    const second = seen[1].messages as Array<{ role: string; content: string }>;
    const last = second[second.length - 1];
    const prev = second[second.length - 2];
    expect(last.role).toBe('user');
    expect(last.content).toContain('<tool_response>');
    expect(last.content).not.toContain('ERROR');
    expect(prev.role).toBe('assistant');
    expect(prev.content).toContain('<tool_call>');
    expect(prev.content).toContain('get_current_time');
    // 不再出现 tool_calls / tool 角色（那两条分支会让原生模板渲染抛错）
    expect(prev.content).not.toContain('tool_calls');
    expect(second.some(m => (m as { role: string }).role === 'tool')).toBe(false);
    expect(starts).toEqual(['get_current_time']);
    expect(ends).toEqual([['get_current_time', true]]);
    expect(res.text).toBe('现在是本地时间。');
    expect(res.telemetry.rounds).toBe(2);
  });

  it('工具轮的标记不进正文（只作为历史里的调用记录）', async () => {
    const { ctx } = makeCtx([
      {
        result: {
          content: '',
          text: '<tool_call>\n{"name": "get_current_time", "arguments": {}}\n</tool_call>',
          tool_calls: [
            { id: 'c', type: 'function', function: { name: 'get_current_time', arguments: '{}' } },
          ],
        },
      },
      { result: { content: '现在 12:00。' } },
    ]);
    const res = await runAgentLoop(ctx, USER);
    expect(res.text).toBe('现在 12:00。');
    expect(res.text).not.toContain('<tool_call>');
  });

  it('工具失败：回灌内容必须带 ERROR 前缀，且上报 ok=false', async () => {
    const { ctx, seen } = makeCtx([
      {
        result: {
          tool_calls: [
            { id: 'c', type: 'function', function: { name: '不存在的工具', arguments: '{}' } },
          ],
        },
      },
      { result: { content: '换个方式回答' } },
    ]);
    const ends: Array<[string, boolean]> = [];
    await runAgentLoop(ctx, USER, { onToolEnd: (n, ok) => ends.push([n, ok]) });

    const second = seen[1].messages as Array<{ role: string; content: string }>;
    expect(second[second.length - 1].content).toMatch(/ERROR: /);
    expect(second[second.length - 1].content).toContain('<tool_response>');
    expect(ends).toEqual([['不存在的工具', false]]);
  });

  it('中断：不把原始文本当终答，未闭合的思考进 reasoning', async () => {
    const { ctx } = makeCtx([
      { result: { interrupted: true, text: '<think>用户问时间，我需要先调用工具' } },
    ]);
    const res = await runAgentLoop(ctx, USER);

    expect(res.telemetry.interrupted).toBe(true);
    expect(res.text).toBe('');
    expect(res.reasoning).toContain('用户问时间');
    expect(res.text).not.toContain('<think>');
  });

  it('中止：shouldStop 为真时立刻返回，不再调用模型', async () => {
    const { ctx, seen } = makeCtx([{ result: { content: '不该被调用' } }]);
    const res = await runAgentLoop(ctx, USER, { shouldStop: () => true });

    expect(seen).toHaveLength(0);
    expect(res.telemetry.interrupted).toBe(true);
    expect(res.text).toBe('');
  });

  it('context_full 透传到遥测', async () => {
    const { ctx } = makeCtx([{ result: { content: '答', context_full: true } }]);
    const res = await runAgentLoop(ctx, USER);
    expect(res.telemetry.contextFull).toBe(true);
  });

  it('解析值与原始文本都在时不会把正文算两遍', async () => {
    const { ctx } = makeCtx([
      { result: { content: '答案', reasoning_content: '想', text: '<think>想</think>答案' } },
    ]);
    const res = await runAgentLoop(ctx, USER);
    expect(res.text).toBe('答案');
    expect(res.reasoning).toBe('想');
  });

  it('解析器没认出内容时，原始分片仍能作为快照流给 UI', async () => {
    const { ctx } = makeCtx([
      {
        tokens: [{ token: '你' }, { token: '好' }],
        result: { text: '你好' },
      },
    ]);
    const snaps: string[] = [];
    const res = await runAgentLoop(ctx, USER, { onContent: t => snaps.push(t) });

    expect(snaps[snaps.length - 1]).toBe('你好');
    expect(res.text).toBe('你好');
  });

  it('思考未闭合时，正文快照为空、思考进 reasoning（不把 <think> 显示成正文）', async () => {
    const { ctx } = makeCtx([
      {
        tokens: [
          {
            token: '<think>正在思考',
            content: '<think>正在思考',
          },
        ],
        result: { content: '<think>正在思考', text: '<think>正在思考' },
      },
    ]);
    const contents: string[] = [];
    const reasonings: string[] = [];
    const res = await runAgentLoop(ctx, USER, {
      onContent: t => contents.push(t),
      onReasoning: t => reasonings.push(t),
    });

    expect(contents.every(c => !c.includes('<think>'))).toBe(true);
    expect(contents.every(c => c === '')).toBe(true);
    expect(reasonings[reasonings.length - 1]).toContain('正在思考');
    expect(res.text).toBe('');
    expect(res.reasoning).toContain('正在思考');
  });
});

describe('采样参数', () => {
  it('只把有值的参数交给 llama.rn，seed=-1 不传（避免锁死随机）', async () => {
    const { ctx, seen } = makeCtx([{ result: { content: 'x' } }]);
    await runAgentLoop(ctx, USER, {
      params: {
        temperature: 0.3,
        topP: 0.9,
        topK: 20,
        minP: 0.02,
        penaltyRepeat: 1.2,
        seed: -1,
        nPredict: 64,
        enableThinking: false,
      },
    });
    const p = seen[0];
    expect(p.temperature).toBe(0.3);
    expect(p.top_p).toBe(0.9);
    expect(p.top_k).toBe(20);
    expect(p.min_p).toBe(0.02);
    expect(p.penalty_repeat).toBe(1.2);
    expect(p.n_predict).toBe(64);
    expect(p.enable_thinking).toBe(false);
    expect('seed' in p).toBe(false);
  });

  it('固定 seed 会传下去（可复现）', async () => {
    const { ctx, seen } = makeCtx([{ result: { content: 'x' } }]);
    await runAgentLoop(ctx, USER, { params: { seed: 42 } });
    expect(seen[0].seed).toBe(42);
  });
});

describe('splitThink', () => {
  it('成对标签', () => {
    expect(splitThink('a<think>想</think>b')).toEqual({ reasoning: '想', content: 'ab' });
  });
  it('未闭合（停止/截断）', () => {
    expect(splitThink('<think>半截思考')).toEqual({ reasoning: '半截思考', content: '' });
  });
  it('没有标签时原样返回', () => {
    expect(splitThink('就是正文')).toEqual({ reasoning: '', content: '就是正文' });
  });
});
