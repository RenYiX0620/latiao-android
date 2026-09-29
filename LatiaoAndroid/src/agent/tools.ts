import RNFS from 'react-native-fs';

/**
 * 手机场景的薄工具集 —— 只放手机上真有用的。
 * 明确不做：run_cmd / 键鼠 / 进程（桌面专属）。
 * 危险写入（覆盖已有笔记）走 confirm 标记，由 loop 问用户。
 */

export type ToolResult = { ok: boolean; output: string };

export type ToolDef = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
  };
  /** true = 执行前需要用户确认 */
  confirm?: boolean;
};

const NOTES_DIR = `${RNFS.DocumentDirectoryPath}/notes`;

export const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: '获取当前日期与时间（设备本地时区）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_note',
      description: '把内容写入本地笔记文件（App 沙箱 notes/ 目录）',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '文件名（不含路径，不含扩展名）' },
          content: { type: 'string', description: '笔记正文' },
        },
        required: ['title', 'content'],
      },
    },
    confirm: true,
  },
  {
    type: 'function',
    function: {
      name: 'read_note',
      description: '读取本地笔记',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string', description: '文件名' } },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_notes',
      description: '列出本地所有笔记标题',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: '抓取一个 URL 的纯文本内容（截断到 4000 字符）',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
      },
    },
  },
];

function notePath(title: string): string {
  const safe = title.replace(/[^\w一-龥-]/g, '_').slice(0, 60) || 'untitled';
  return `${NOTES_DIR}/${safe}.md`;
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case 'get_current_time':
        return { ok: true, output: new Date().toString() };

      case 'write_note': {
        const title = String(args.title ?? '');
        const content = String(args.content ?? '');
        if (!title) {
          return { ok: false, output: 'title 必填' };
        }
        if (!(await RNFS.exists(NOTES_DIR))) {
          await RNFS.mkdir(NOTES_DIR);
        }
        await RNFS.writeFile(notePath(title), content, 'utf8');
        return { ok: true, output: `已写入笔记：${title}` };
      }

      case 'read_note': {
        const p = notePath(String(args.title ?? ''));
        if (!(await RNFS.exists(p))) {
          return { ok: false, output: `笔记不存在：${args.title}` };
        }
        return { ok: true, output: await RNFS.readFile(p, 'utf8') };
      }

      case 'list_notes': {
        if (!(await RNFS.exists(NOTES_DIR))) {
          return { ok: true, output: '（暂无笔记）' };
        }
        const files = await RNFS.readDir(NOTES_DIR);
        const names = files.filter(f => f.isFile()).map(f => f.name);
        return { ok: true, output: names.length ? names.join('\n') : '（暂无笔记）' };
      }

      case 'fetch_url': {
        const url = String(args.url ?? '');
        if (!/^https?:\/\//i.test(url)) {
          return { ok: false, output: '需要 http(s) URL' };
        }
        const resp = await fetch(url);
        const text = await resp.text();
        return { ok: true, output: text.slice(0, 4000) };
      }

      default:
        return { ok: false, output: `未知工具：${name}` };
    }
  } catch (e) {
    return { ok: false, output: `工具异常：${String(e)}` };
  }
}

/** 让 JSON-Schema 里也暴露给模型（llama.rn tools 参数用裸 schema 数组） */
export function toolsForModel(): object[] {
  return TOOLS.map(t => ({
    type: 'function',
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));
}
