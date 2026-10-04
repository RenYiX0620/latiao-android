/** 内置模型目录 —— 小模型优先，手机可跑。URL 均为 Hugging Face 直链。
 *
 * 2026-10-04 修正：
 * - 原第 4 项 `unsloth/gemma-2-2b-it-GGUF` 实测 404（且 Gemma 全系是 gated 仓库，
 *   App 没有 HF token 通道，点了必然失败），撤下
 * - 首选换成 Qwen3 系列：实测会真正发起工具调用，Agent 卖点才成立
 *   （Qwen2.5 0.5B 实测无论怎么提示都不调工具，只适合纯聊天）
 */
export type ModelEntry = {
  id: string;
  name: string;
  repo: string;
  file: string;
  /** 约数，仅展示 */
  approxSize: string;
  /** 推荐手机配置提示 */
  note?: string;
  /** 实测是否会发起工具调用（决定工具场景下能不能用） */
  toolCapable?: boolean;
};

export const MODEL_CATALOG: ModelEntry[] = [
  {
    id: 'qwen3-0.6b-q4_k_m',
    name: 'Qwen3 0.6B',
    repo: 'unsloth/Qwen3-0.6B-GGUF',
    file: 'Qwen3-0.6B-Q4_K_M.gguf',
    approxSize: '≈400 MB',
    note: '会调工具 · 低配首选，全程实测可用',
    toolCapable: true,
  },
  {
    id: 'qwen3-1.7b-q4_k_m',
    name: 'Qwen3 1.7B',
    repo: 'unsloth/Qwen3-1.7B-GGUF',
    file: 'Qwen3-1.7B-Q4_K_M.gguf',
    approxSize: '≈1.1 GB',
    note: '会调工具 · 回答更稳，建议 6GB+ 机型',
    toolCapable: true,
  },
  {
    id: 'qwen2.5-0.5b-q4_k_m',
    name: 'Qwen2.5 0.5B Instruct',
    repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
    file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    approxSize: '≈400 MB',
    note: '最轻量；实测不发起工具调用，只适合纯聊天',
    toolCapable: false,
  },
  {
    id: 'qwen2.5-1.5b-q4_k_m',
    name: 'Qwen2.5 1.5B Instruct',
    repo: 'Qwen/Qwen2.5-1.5B-Instruct-GGUF',
    file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
    approxSize: '≈1.0 GB',
    note: '中文均衡之选',
  },
  {
    id: 'llama-3.2-1b-q4_k_m',
    name: 'Llama 3.2 1B Instruct',
    repo: 'unsloth/Llama-3.2-1B-Instruct-GGUF',
    file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    approxSize: '≈770 MB',
    note: '英文强',
  },
];

export function hfDownloadUrl(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${file}`;
}
