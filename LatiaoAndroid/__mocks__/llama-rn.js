/* jest mock — llama.rn 原生模块在 Node 里不可用 */
module.exports = {
  initLlama: jest.fn(async () => ({
    completion: jest.fn(async () => ({ text: '', content: '', tool_calls: [] })),
    release: jest.fn(async () => undefined),
  })),
  releaseAllLlama: jest.fn(async () => undefined),
  installJsi: jest.fn(async () => undefined),
};
