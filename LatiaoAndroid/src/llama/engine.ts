import { initLlama, type LlamaContext, type TokenData } from 'llama.rn';

/**
 * 本地模型引擎封装 —— POC。
 * 真机链路：GGUF 路径 → initLlama → completion 流式吐 token。
 * 与桌面版 llama-server 同引擎（llama.cpp），手机侧走 llama.rn。
 */

export type LoadProgress = (progress: number) => void;

export type LoadOpts = { nCtx?: number; nGpuLayers?: number; nThreads?: number };

let ctx: LlamaContext | null = null;

export function isLoaded(): boolean {
  return ctx !== null;
}

export function getContext(): LlamaContext | null {
  return ctx;
}

export async function loadModel(
  modelPath: string,
  onProgress?: LoadProgress,
  opts?: LoadOpts,
): Promise<LlamaContext> {
  if (ctx) {
    await ctx.release();
    ctx = null;
  }
  ctx = await initLlama(
    {
      model: modelPath,
      n_ctx: opts?.nCtx ?? 4096,
      n_gpu_layers: opts?.nGpuLayers ?? 4,
      n_threads: opts?.nThreads ?? 2,
    },
    onProgress,
  );
  return ctx;
}

export async function stopGenerate(): Promise<void> {
  if (ctx) {
    await ctx.stopCompletion().catch(() => undefined);
  }
}

export async function unloadModel(): Promise<void> {
  if (ctx) {
    await ctx.release();
    ctx = null;
  }
}

export type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string };

/** 流式对话：每个 token 回调，结束返回完整文本。 */
export async function chatStream(
  messages: ChatMsg[],
  onToken: (data: TokenData) => void,
): Promise<string> {
  if (!ctx) {
    throw new Error('模型未加载');
  }
  let acc = '';
  const res = await ctx.completion(
    { messages, n_predict: 1024, temperature: 0.7 },
    data => {
      if (data?.token) {
        acc += data.token;
      }
      onToken(data);
    },
  );
  return res.text ?? acc;
}
