/* jest mock — RNFS 原生实现不可用：这里用内存文件系统，让 store 的原子写/损坏留档可测 */
const files = new Map();

const exists = jest.fn(async p => files.has(p));
const readFile = jest.fn(async p => {
  if (!files.has(p)) {
    throw new Error(`ENOENT: ${p}`);
  }
  return files.get(p);
});
const writeFile = jest.fn(async (p, content) => {
  files.set(p, String(content));
});
const unlink = jest.fn(async p => {
  if (!files.has(p)) {
    throw new Error(`ENOENT: ${p}`);
  }
  files.delete(p);
});
const moveFile = jest.fn(async (from, to) => {
  if (!files.has(from)) {
    throw new Error(`ENOENT: ${from}`);
  }
  files.set(to, files.get(from));
  files.delete(from);
});
const mkdir = jest.fn(async () => undefined);
/** 由内存文件表推导目录内容（够 vision 的投影器配对用） */
const readDir = jest.fn(async dir => {
  const out = [];
  const seen = new Set();
  for (const p of files.keys()) {
    if (!p.startsWith(`${dir}/`)) {
      continue;
    }
    const rest = p.slice(dir.length + 1);
    const name = rest.split('/')[0];
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const isFile = !rest.includes('/');
    out.push({
      name,
      path: `${dir}/${name}`,
      isFile: () => isFile,
      size: isFile ? (files.get(p) ?? '').length : 0,
    });
  }
  return out;
});
const stat = jest.fn(async p => {
  if (!files.has(p)) {
    throw new Error(`ENOENT: ${p}`);
  }
  return { size: files.get(p).length };
});
/** 切片读取（RNFS.read(path, length, position, encoding)）——模型头预检用 */
const read = jest.fn(async (p, length, position, encoding) => {
  const content = files.get(p);
  if (content === undefined) {
    throw new Error(`ENOENT: ${p}`);
  }
  const buf = Buffer.from(content, 'utf8').subarray(position, position + length);
  return buf.toString(encoding === 'base64' ? 'base64' : 'utf8');
});
const copyFile = jest.fn(async (from, to) => {
  files.set(to, files.get(from) ?? '');
});
let downloadPlan = null; // { statusCode, bodyBytes, contentLength }
const downloadFile = jest.fn(({ toFile, progress }) => {
  const plan = downloadPlan || { statusCode: 200, bodyBytes: 2 * 1024 * 1024, contentLength: null };
  const body = 'x'.repeat(plan.bodyBytes);
  files.set(toFile, body);
  if (progress) {
    progress({
      bytesWritten: plan.bodyBytes,
      contentLength: plan.contentLength == null ? plan.bodyBytes : plan.contentLength,
    });
  }
  return { jobId: 1, promise: Promise.resolve({ statusCode: plan.statusCode }) };
});

/** 磁盘信息：默认给足空间，测试里可以改 __fs.setFreeSpace 制造空间不足 */
let freeSpace = 64 * 1e9;
const getFSInfo = jest.fn(async () => ({ totalSpace: 128 * 1e9, freeSpace }));
const stopDownload = jest.fn(() => undefined);

module.exports = {
  DocumentDirectoryPath: '/tmp/latiao-docs',
  exists,
  readFile,
  writeFile,
  unlink,
  moveFile,
  mkdir,
  readDir,
  stat,
  read,
  copyFile,
  downloadFile,
  getFSInfo,
  stopDownload,
  __fs: {
    files,
    seed: (p, content) => files.set(p, String(content)),
    get: p => files.get(p),
    has: p => files.has(p),
    clear: () => files.clear(),
    keys: () => [...files.keys()],
    setFreeSpace: n => {
      freeSpace = n;
    },
    setDownloadPlan: p => {
      downloadPlan = p;
    },
  },
};
