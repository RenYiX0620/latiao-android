/* jest mock — 原生 RNFS 在 Node 里不可执行 */
module.exports = {
  DocumentDirectoryPath: '/tmp/latiao-docs',
  exists: jest.fn(async () => false),
  mkdir: jest.fn(async () => undefined),
  unlink: jest.fn(async () => undefined),
  readFile: jest.fn(async () => ''),
  writeFile: jest.fn(async () => undefined),
  readDir: jest.fn(async () => []),
  downloadFile: jest.fn(() => ({ promise: jest.fn(async () => ({ statusCode: 200 })) })),
};
