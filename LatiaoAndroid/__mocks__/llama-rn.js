/* jest mock — llama.rn 原生模块在 Node 里不可用；这里给一份可注入脚本的实现 */
let script = [];
let params = [];
let stops = 0;

const emptyResult = () => ({
  text: '',
  content: '',
  reasoning_content: '',
  tool_calls: [],
  timings: { prompt_n: 10, predicted_n: 4, predicted_per_second: 30, cache_n: 0 },
  context_full: false,
  truncated: false,
  interrupted: false,
});

const ctx = {
  completion: jest.fn(async p => {
    params.push(p);
    const step = script.shift() ?? {};
    return { ...emptyResult(), ...(step.result ?? {}) };
  }),
  release: jest.fn(async () => undefined),
  stopCompletion: jest.fn(async () => {
    stops += 1;
  }),
  model: {
    desc: 'mock-model',
    size: 1,
    nParams: 1,
    chatTemplates: { llamaChat: true, jinja: { toolUse: false, defaultCaps: { tools: true } } },
  },
  gpu: false,
  reasonNoGPU: 'mock',
  devices: [],
  systemInfo: 'mock',
};

module.exports = {
  initLlama: jest.fn(async () => ctx),
  releaseAllLlama: jest.fn(async () => undefined),
  installJsi: jest.fn(async () => undefined),
  __mock: {
    ctx,
    setScript: s => {
      script = s;
    },
    getParams: () => params,
    stopCount: () => stops,
    reset: () => {
      script = [];
      params = [];
      stops = 0;
    },
  },
};
