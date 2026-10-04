/* jest mock — react-native-tts 的原生模块在 Node 里不可用：给一份可注入的假引擎 */
let voices = [
  { id: 'zh-cn-x', name: '中文测试音', language: 'zh-CN' },
  { id: 'en-us-y', name: 'Test English', language: 'en-US' },
];
let initError = null;
let spoken = [];
let listeners = {};

const Tts = {
  getInitStatus: jest.fn(async () => {
    if (initError) {
      throw initError;
    }
    return 'success';
  }),
  voices: jest.fn(async () => voices),
  setDefaultLanguage: jest.fn(async () => undefined),
  setDefaultRate: jest.fn(async () => undefined),
  speak: jest.fn(text => {
    spoken.push(text);
  }),
  stop: jest.fn(async () => {
    spoken = [];
  }),
  addEventListener: jest.fn((event, cb) => {
    listeners[event] = cb;
  }),
  removeEventListener: jest.fn(event => {
    delete listeners[event];
  }),
};

module.exports = {
  __esModule: true,
  default: Tts,
  __mock: {
    /** 假引擎本体，方便断言 speak/stop/setDefaultLanguage 等被怎么调用 */
    api: Tts,
    setVoices: v => {
      voices = v;
    },
    failInit: e => {
      initError = e;
    },
    spoken: () => spoken,
    fire: event => listeners[event] && listeners[event]({ utteranceId: '1' }),
    reset: () => {
      voices = [
        { id: 'zh-cn-x', name: '中文测试音', language: 'zh-CN' },
        { id: 'en-us-y', name: 'Test English', language: 'en-US' },
      ];
      initError = null;
      spoken = [];
      listeners = {};
      Object.values(Tts).forEach(fn => {
        if (typeof fn === 'function' && typeof fn.mockClear === 'function') {
          fn.mockClear();
        }
      });
    },
  },
};
