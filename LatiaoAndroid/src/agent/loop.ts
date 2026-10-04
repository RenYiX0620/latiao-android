import type { LlamaContext } from 'llama.rn';
import { executeTool, TOOLS, toolsForModel } from './tools';
import type { MsgPart } from '../models/vision';

/**
 * 精简 agent 循环 —— 桌面版 Loop Engineering 的手机子集：
 * - MAX_STEPS 硬上限（防死循环）
 * - 工具结果回填 messages
 * - confirm 级工具：先问用户，拒绝则把拒绝结果回给模型
 * - 中止贯穿：用户按停止后，不再进入下一轮、也不再执行工具
 * - 思考与正文分离（reasoning_format: deepseek + <think> 兜底切分）
 * 不做：子代理、cron、复杂验证（后续再加）。
 */

export const MAX_STEPS = 8;

/** 消息内容：纯文本，或多模态部件（图片走 {type:'image_url'}） */
export type AgentMsg = {
  role: 'system' | 'user' | 'assistant';
  content: string | MsgPart[];
};

export type AskConfirm = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<boolean>;

export type LoopTelemetry = {
  rounds: number;
  /** 最后一轮 prompt 规模 ≈ 当前上下文占用 */
  promptTokens: number;
  predicted: number;
  tokensPerSec: number;
  cachedTokens: number;
  /** 首字延迟（毫秒） */
  ttftMs: number | null;
  contextFull: boolean;
  truncated: boolean;
  interrupted: boolean;
  exhausted: boolean;
};

export type LoopResult = {
  /** 最终答复正文（已剔除思考块） */
  text: string;
  /** 思考过程（可折叠显示，不进上下文） */
  reasoning: string;
  telemetry: LoopTelemetry;
};

export type LoopParams = {
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  penaltyRepeat?: number;
  seed?: number;
  nPredict?: number;
  /** 是否让模板输出思考块（Qwen3 等支持） */
  enableThinking?: boolean;
  /** 上下文长度（用于发送前做预算预检） */
  nCtx?: number;
};

export type LoopCallbacks = {
  /**
   * 正文快照（累计值，已剔掉思考与工具调用标记）。
   * 是快照不是增量：调用方直接覆盖显示即可，不用做加法。
   */
  onContent?: (text: string) => void;
  /** 思考快照（累计值，可折叠显示，不进上下文） */
  onReasoning?: (text: string) => void;
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onToolEnd?: (name: string, ok: boolean, output: string) => void;
  askConfirm?: AskConfirm;
  log?: (line: string) => void;
  /** 采样参数（来自设置页） */
  params?: LoopParams;
  /** 返回 true 则中止（用户点了停止） */
  shouldStop?: () => boolean;
};

/** 只把「有值」的采样参数交给 llama.rn，避免 undefined 落到原生默认值判断里 */
function samplingParams(p: LoopParams = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    n_predict: p.nPredict ?? 1024,
    temperature: p.temperature ?? 0.7,
  };
  if (typeof p.topP === 'number') {
    out.top_p = p.topP;
  }
  if (typeof p.topK === 'number') {
    out.top_k = p.topK;
  }
  if (typeof p.minP === 'number') {
    out.min_p = p.minP;
  }
  if (typeof p.penaltyRepeat === 'number') {
    out.penalty_repeat = p.penaltyRepeat;
  }
  if (typeof p.seed === 'number' && p.seed >= 0) {
    out.seed = p.seed;
  }
  if (typeof p.enableThinking === 'boolean') {
    out.enable_thinking = p.enableThinking;
  }
  return out;
}

function isConfirmTool(name: string): boolean {
  return TOOLS.some(t => t.function.name === name && t.confirm);
}

/** 工具轮里的消息形态
 *
 * 实测（Qwen3-0.6B + llama.rn 0.13.0-rc.6）：第二轮一旦带上 `assistant.tool_calls`
 * 或 `role:"tool"`，llama.rn 的原生模板渲染就会抛非 std 异常，JS 侧只看到
 * 「Unknown error」，工具轮永远跑不完。这里改成与模板输出**文本等价**的形态：
 * 助手轮正文里写 <tool_call>{...}</tool_call>，工具结果放进 user 轮的
 * <tool_response>…</tool_response> —— 只经过 system/user/assistant 三个简单分支，
 * 模型看到的 prompt 文本与走 tool_calls 分支时一致。
 */
function toolCallText(name: string, argsJson: string): string {
  let args = argsJson || '{}';
  try {
    JSON.parse(args);
  } catch {
    args = '{}';
  }
  return `<tool_call>\n{"name": "${name}", "arguments": ${args}}\n</tool_call>`;
}

function toolResponseText(output: string): string {
  return `<tool_response>\n${output}\n</tool_response>`;
}

/**
 * 预算预检：用模型自己的模板+分词器算准这一轮的 prompt 大小（prompt + 生成）。
 * 拿不到就返回 null（放行，不挡正常使用）。
 */
async function promptBudget(
  ctx: LlamaContext,
  msgs: AgentMsg[],
  nPredict: number,
): Promise<number | null> {
  try {
    const c = ctx as unknown as {
      getFormattedChat: (
        m: unknown,
        t: null,
        o: Record<string, unknown>,
      ) => Promise<{ prompt?: string }>;
      tokenize: (text: string) => Promise<{ tokens: number[] }>;
    };
    const fmt = await c.getFormattedChat(msgs, null, {
      tools: toolsForModel(),
      parallel_tool_calls: false,
    });
    const promptText = fmt?.prompt ?? '';
    if (!promptText) {
      return null;
    }
    const { tokens } = await c.tokenize(promptText);
    return tokens.length + nPredict;
  } catch {
    return null;
  }
}
export function splitThink(text: string): { reasoning: string; content: string } {
  if (!/<\s*(think|thinking|reasoning)\s*>/i.test(text)) {
    return { reasoning: '', content: text };
  }
  const re = /<\s*(?:think|thinking|reasoning)\s*>([\s\S]*?)(?:<\s*\/\s*(?:think|thinking|reasoning)\s*>|$)/gi;
  const blocks: string[] = [];
  let content = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    content += text.slice(last, m.index);
    blocks.push(m[1].trim());
    last = m.index + m[0].length;
  }
  content += text.slice(last);
  return {
    reasoning: blocks.filter(Boolean).join('\n\n').trim(),
    content: content.trim(),
  };
}

export async function runAgentLoop(
  ctx: LlamaContext,
  messages: AgentMsg[],
  cb: LoopCallbacks = {},
): Promise<LoopResult> {
  const msgs = [...messages];
  let text = '';
  let reasoning = '';
  let rounds = 0;
  let promptTokens = 0;
  let predicted = 0;
  let tokensPerSec = 0;
  let cachedTokens = 0;
  let ttftMs: number | null = null;
  let contextFull = false;
  let truncated = false;
  let interrupted = false;
  const stopped = () => cb.shouldStop?.() === true;

  const telemetry = (exhausted = false): LoopTelemetry => ({
    rounds,
    promptTokens,
    predicted,
    tokensPerSec,
    cachedTokens,
    ttftMs,
    contextFull,
    truncated,
    interrupted,
    exhausted,
  });

  for (let step = 0; step < MAX_STEPS; step++) {
    if (stopped()) {
      interrupted = true;
      return { text, reasoning, telemetry: telemetry() };
    }
    cb.log?.(`step ${step + 1}/${MAX_STEPS}`);

    // 预算预检：先把 prompt 精确算一遍。贴边/放不下时原生会直接抛「Unknown error」，
    // 与其让它抛，不如在这里给出人话结论（并亮起上下文告警）。
    const nPredict = cb.params?.nPredict ?? 1024;
    const nCtx = cb.params?.nCtx ?? 0;
    if (nCtx > 0) {
      const need = await promptBudget(ctx, msgs, nPredict);
      if (need !== null && need > nCtx * 0.95) {
        contextFull = true;
        // 让告警条显示真实的对话占用（不含本轮的生成预留）
        promptTokens = Math.max(0, need - nPredict);
        cb.log?.(`预算不足：需要 ${need} / n_ctx ${nCtx}`);
        return {
          text:
            `上下文放不下了：这一轮需要约 ${need} token（含生成 ${nPredict}），` +
            `当前 n_ctx = ${nCtx}。点上面的「加大上下文」，或新建会话继续。`,
          reasoning,
          telemetry: telemetry(),
        };
      }
    }

    const startedAt = Date.now();
    let firstTokenAt: number | null = null;
    // llama.rn 给的是「累计快照」，不是增量；而且思考未闭合时解析会把 <think> 留在 content 里。
    // 所以：只存快照，显示前一律过一遍 splitThink，思考永远进思考块、正文永远干净。
    let sawParsed = false;
    let contentSnap = '';
    let reasoningSnap = '';
    let rawSnap = '';
    let shownContent = '';
    let shownReasoning = '';

    const res = await ctx.completion(
      {
        messages: msgs as never,
        ...samplingParams(cb.params),
        tools: toolsForModel(),
        parallel_tool_calls: false,
        // 让 llama.cpp 尽量把思考分离进 reasoning_content
        reasoning_format: 'deepseek',
      },
      data => {
        // UI 侧回调抛异常会顺着原生 token 回调冒出去，被 llama.rn 的 catch(...) 兜成
        // 「Unknown error」并且整轮失败 —— 所以这里必须自己兜住。
        try {
          const c = data?.content ?? '';
          const r = data?.reasoning_content ?? '';
          if (firstTokenAt === null && (data?.token || c || r)) {
            firstTokenAt = Date.now();
          }
          if (r) {
            reasoningSnap = r;
            sawParsed = true;
          }
          if (c) {
            contentSnap = c;
            sawParsed = true;
          }
          // 解析器完全不认时退回原始分片，保证用户始终看得到输出
          if (!sawParsed && data?.token) {
            rawSnap += data.token;
          }
          const split = splitThink(sawParsed ? contentSnap : rawSnap);
          const nextReasoning = [reasoningSnap, split.reasoning].filter(Boolean).join('\n\n');
          if (split.content !== shownContent) {
            shownContent = split.content;
            cb.onContent?.(shownContent);
          }
          if (nextReasoning !== shownReasoning) {
            shownReasoning = nextReasoning;
            cb.onReasoning?.(shownReasoning);
          }
        } catch (e) {
          cb.log?.(`流式回调异常（已忽略）：${String(e)}`);
        }
      },
    );

    rounds = step + 1;
    const tim = res.timings;
    if (tim) {
      promptTokens = tim.prompt_n ?? promptTokens;
      predicted += tim.predicted_n ?? 0;
      tokensPerSec = tim.predicted_per_second ?? tokensPerSec;
      cachedTokens = tim.cache_n ?? cachedTokens;
    }
    if (ttftMs === null && firstTokenAt !== null) {
      ttftMs = firstTokenAt - startedAt;
    }
    contextFull = contextFull || res.context_full === true;
    truncated = truncated || res.truncated === true;

    // 中断：llama.rn 不给解析字段；用已经流出去的快照，没有再退回原始 text
    if (res.interrupted) {
      interrupted = true;
      const split = splitThink(shownContent || rawSnap || res.text || '');
      text = [text, split.content].filter(Boolean).join('\n\n');
      reasoning = [reasoning, shownReasoning, split.reasoning].filter(Boolean).join('\n\n');
      return { text, reasoning, telemetry: telemetry() };
    }

    const toolCalls = res.tool_calls ?? [];

    if (!toolCalls.length) {
      // 解析值是权威；原始 text 里含思考与 <tool_call> 标记，只在解析为空时才用
      const split = splitThink(res.content || res.text || '');
      const roundContent = split.content;
      const roundReasoning = [res.reasoning_content ?? '', split.reasoning]
        .filter(Boolean)
        .join('\n\n');
      text = [text, roundContent].filter(Boolean).join('\n\n');
      reasoning = [reasoning, roundReasoning].filter(Boolean).join('\n\n');
      if (!text && !reasoning) {
        text = '（模型没有输出内容）';
      }
      return { text, reasoning, telemetry: telemetry() };
    }

    // 模型要调工具：以文本等价形态塞回历史（避免 minja 的 tool_calls/tool 分支）
    const callsText = toolCalls
      .map(tc => toolCallText(tc.function.name, tc.function.arguments))
      .join('\n');
    msgs.push({
      role: 'assistant',
      content: [res.content || '', callsText].filter(Boolean).join('\n'),
    });

    // 工具调用前的中间正文（有些模型会先说一句再做）。
    // 注意只能用解析后的 content：原始 text 里是 <tool_call> 标记，不能当正文显示/落库。
    const preamble = res.content ?? '';
    if (preamble) {
      text = [text, preamble].filter(Boolean).join('\n\n');
    }

    const toolOutputs: string[] = [];
    for (const tc of toolCalls) {
      if (stopped()) {
        interrupted = true;
        return { text, reasoning, telemetry: telemetry() };
      }
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }
      cb.onToolStart?.(tc.function.name, args);

      let output: string;
      let ok: boolean;
      if (isConfirmTool(tc.function.name)) {
        const approved = cb.askConfirm
          ? await cb.askConfirm(tc.function.name, args)
          : false;
        if (approved) {
          const r = await executeTool(tc.function.name, args);
          ok = r.ok;
          output = r.output;
        } else {
          ok = false;
          output = '用户拒绝了该操作';
        }
      } else {
        const r = await executeTool(tc.function.name, args);
        ok = r.ok;
        output = r.output;
      }

      cb.onToolEnd?.(tc.function.name, ok, output);
      toolOutputs.push((ok ? '' : 'ERROR: ') + output);
    }

    if (toolOutputs.length) {
      msgs.push({
        role: 'user',
        content: toolOutputs.map(toolResponseText).join('\n'),
      });
    }
    // 继续下一轮：让模型消化工具结果
  }

  return {
    text: text || '（已达步数上限，未产出最终答案）',
    reasoning,
    telemetry: telemetry(true),
  };
}
