/** 内置模型目录 —— 小模型优先，手机可跑。URL 均为 Hugging Face 直链。 */

export type ModelEntry = {
  id: string;
  name: string;
  repo: string;
  file: string;
  /** 约数，仅展示 */
  approxSize: string;
  /** 推荐手机配置提示 */
  note?: string;
};

export const MODEL_CATALOG: ModelEntry[] = [
  {
    id: 'qwen2.5-0.5b-q4_k_m',
    name: 'Qwen2.5 0.5B Instruct',
    repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
    file: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
    approxSize: '≈400 MB',
    note: '最轻量，低配机可用',
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
  {
    id: 'gemma-2-2b-q4_k_m',
    name: 'Gemma 2 2B Instruct',
    repo: 'unsloth/gemma-2-2b-it-GGUF',
    file: 'gemma-2-2b-it-Q4_K_M.gguf',
    approxSize: '≈1.6 GB',
    note: '2B 里质价比高',
  },
];

export function hfDownloadUrl(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${file}`;
}
