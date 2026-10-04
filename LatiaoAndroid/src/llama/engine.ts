import { initLlama, type LlamaContext, type TokenData } from 'llama.rn';

/**
 * 本地模型引擎封装。
 * 与桌面版 llama-server 同引擎（llama.cpp），手机侧走 llama.rn。
 */

export type LoadProgress = (progress: number) => void;

export type LoadOpts = {
  nCtx?: number;
  nGpuLayers?: number;
  nThreads?: number;
  /** 视觉投影器（mmproj）路径；给了就尝试开启多模态 */
  mmproj?: string | null;
};

let ctx: LlamaContext | null = null;
let loadedPath: string | null = null;
let loadedProjector: string | null = null;
let visionEnabled = false;

export function isLoaded(): boolean {
  return ctx !== null;
}

export function getContext(): LlamaContext | null {
  return ctx;
}

/** 当前已加载模型的路径（用于判断「已加载」是不是就是这个模型） */
export function getLoadedPath(): string | null {
  return loadedPath;
}

export async function loadModel(
  modelPath: string,
  onProgress?: LoadProgress,
  opts?: LoadOpts,
): Promise<LlamaContext> {
  if (ctx) {
    await ctx.release();
    ctx = null;
    loadedPath = null;
    loadedProjector = null;
    visionEnabled = false;
  }
  const next = await initLlama(
    {
      model: modelPath,
      n_ctx: opts?.nCtx ?? 4096,
      n_gpu_layers: opts?.nGpuLayers ?? 0,
      n_threads: opts?.nThreads ?? 4,
    },
    onProgress,
  );
  ctx = next;
  loadedPath = modelPath;

  // 视觉：投影器单独加载；失败就当没有（不影响纯文本对话）
  if (opts?.mmproj) {
    try {
      const ok = await next.initMultimodal({
        path: opts.mmproj,
        use_gpu: false,
        image_max_tokens: 512,
      });
      visionEnabled = ok === true;
      loadedProjector = visionEnabled ? opts.mmproj : null;
      console.log('[vision] initMultimodal =>', ok);
    } catch (e) {
      visionEnabled = false;
      loadedProjector = null;
      console.log('[vision] initMultimodal 抛错：', String(e));
    }
  }
  return next;
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
    loadedPath = null;
    loadedProjector = null;
    visionEnabled = false;
  }
}

/** 是否已启用视觉（= 投影器加载成功） */
export function isVisionEnabled(): boolean {
  return visionEnabled;
}

export function getLoadedProjector(): string | null {
  return loadedProjector;
}

/**
 * 加载后实际落到哪个后端（设置里拨了 GPU 层数，这里给出真实答案）。
 * 只返回结构化信息，文案由界面层翻译。
 */
export type BackendInfo = { kind: 'cpu' | 'gpu'; devices: string; reason: string };

export function backendInfo(): BackendInfo | null {
  if (!ctx) {
    return null;
  }
  return {
    kind: ctx.gpu ? 'gpu' : 'cpu',
    devices: ctx.devices?.length ? ctx.devices.join(', ') : '',
    reason: ctx.reasonNoGPU ?? '',
  };
}

export type ToolSupport = 'yes' | 'no' | 'unknown';

/** 这个模型到底支不支持工具调用（决定要不要提示用户） */
export function toolSupport(): ToolSupport {
  const m = ctx?.model;
  if (!m) {
    return 'unknown';
  }
  const jinja = m.chatTemplates?.jinja;
  if (jinja?.toolUseCaps?.tools || jinja?.defaultCaps?.tools || jinja?.toolUse) {
    return 'yes';
  }
  if (jinja) {
    return 'no';
  }
  return 'unknown';
}

/** 模型上下文上限（用于「加大上下文」的上限提示） */
export function modelContextMax(): number {
  const n = ctx?.model as unknown as { nCtxTrain?: number } | undefined;
  return typeof n?.nCtxTrain === 'number' ? n.nCtxTrain : 0;
}

export type ChatMsg = { role: 'user' | 'assistant' | 'system'; content: string };

/** 流式对话：每个 token 回调，结束返回完整文本（未使用 agent 循环时的简单入口）。 */
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
