import type { LlamaContext } from 'llama.rn';
import { executeTool, TOOLS, toolsForModel } from './tools';

/**
 * 精简 agent 循环 —— 桌面版 Loop Engineering 的手机子集：
 * - MAX_STEPS 硬上限（防死循环）
 * - 工具结果回填 messages
 * - confirm 级工具：先问用户，拒绝则把拒绝结果回给模型
 * 不做：子代理、cron、复杂验证（后续再加）。
 */

export const MAX_STEPS = 8;

export type AgentMsg =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls: Array<{
        id?: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export type AskConfirm = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<boolean>;

export type LoopCallbacks = {
  onAssistantText?: (text: string) => void;
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  onToolEnd?: (name: string, ok: boolean, output: string) => void;
  askConfirm?: AskConfirm;
  log?: (line: string) => void;
  /** 生成温度（来自设置页） */
  temperature?: number;
};

function isConfirmTool(name: string): boolean {
  return TOOLS.some(t => t.function.name === name && t.confirm);
}

export async function runAgentLoop(
  ctx: LlamaContext,
  messages: AgentMsg[],
  cb: LoopCallbacks = {},
): Promise<string> {
  const msgs = [...messages];
  let finalText = '';

  for (let step = 0; step < MAX_STEPS; step++) {
    cb.log?.(`step ${step + 1}/${MAX_STEPS}`);

    const res = await ctx.completion(
      {
        messages: msgs as never,
        n_predict: 1024,
        temperature: cb.temperature ?? 0.7,
        tools: toolsForModel(),
        parallel_tool_calls: false,
      },
      data => {
        if (data?.token && cb.onAssistantText) {
          cb.onAssistantText(data.token);
        }
      },
    );

    const toolCalls = res.tool_calls ?? [];

    if (!toolCalls.length) {
      finalText = res.content || res.text || '';
      return finalText;
    }

    // 模型要调工具：把 assistant tool_calls 塞回历史
    msgs.push({
      role: 'assistant',
      content: res.content || null,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }
      cb.onToolStart?.(tc.function.name, args);

      let output: string;
      if (isConfirmTool(tc.function.name)) {
        const approved = cb.askConfirm
          ? await cb.askConfirm(tc.function.name, args)
          : false;
        output = approved
          ? (await executeTool(tc.function.name, args)).output
          : '用户拒绝了该操作';
      } else {
        const r = await executeTool(tc.function.name, args);
        output = (r.ok ? '' : 'ERROR: ') + r.output;
      }

      cb.onToolEnd?.(tc.function.name, !output.startsWith('ERROR'), output);
      msgs.push({
        role: 'tool',
        tool_call_id: tc.id ?? `call_${step}`,
        content: output,
      });
    }
    // 继续下一轮：让模型消化工具结果
  }

  return finalText || '（已达步数上限，未产出最终答案）';
}
