import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { runAgentLoop, type AgentMsg, type LoopTelemetry } from '../agent/loop';
import {
  backendInfo,
  getContext,
  getLoadedPath,
  isLoaded,
  isVisionEnabled,
  loadModel,
  stopGenerate,
  toolSupport,
  unloadModel,
} from '../llama/engine';
import DocumentPicker, { isCancel as isPickCancel } from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import { checkModelFile, loadFailureHint } from '../models/modelCheck';
import {
  attachmentMarker,
  buildUserContent,
  findProjector,
  isImageFile,
  type Attachment,
} from '../models/vision';
import {
  loadPrefsExt,
  modelKey,
  persistSessionMessages,
  resolveParams,
  savePrefsExt,
  takeLoadIssue,
  toPersistable,
  type ChatMsg,
  type PrefsExt,
  type Session,
} from '../store/prefs';
import ThinkingBlock from '../components/ThinkingBlock';
import { useTheme, type Theme } from '../theme';
import { useT, type MsgKey, type TFn, type Lang } from '../i18n';
import { speakText, speechLangFor, stopSpeaking } from '../tts';

/**
 * 对话页：
 * - 空状态引导：吉祥物 + 步骤 + 「选择模型」大按钮
 * - 模型未加载：输入框禁用并说明原因
 * - 左上角 ☰ 开抽屉（导航/历史）
 * - 会话落盘：sessions.json（只更新消息，改名/置顶不会被回滚）
 * - 思考与正文分离显示；停止可真正中止；每轮给出 tok/s 等遥测
 */

type UiMsg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  ts?: number;
  streaming?: boolean;
  interrupted?: boolean;
  stats?: string;
  /** 这一轮附带的图片（只在本次会话显示，历史里留文字标记） */
  imagePath?: string;
};

export type ChatScreenProps = {
  modelPath: string;
  /** 界面语言（决定朗读用哪套系统语音） */
  lang?: Lang;
  onPickModels: () => void;
  onOpenDrawer: () => void;
  onOpenSettings?: () => void;
  prefsVersion?: number;
  activeSession: Session | null;
  onSessionChange: (s: Session) => void;
};

/** 会话标题还是占位（可能存着中文占位，也可能已是当前语言） */
function isPlaceholderTitle(title: string, t: TFn): boolean {
  return title === '新对话' || title === t('chat.newSessionPlaceholder');
}

function makeAskConfirm(t: TFn) {
  return (toolName: string, args: Record<string, unknown>): Promise<boolean> =>
    new Promise(resolve => {
      Alert.alert(
        t('chat.confirmTitle', { tool: toolName }),
        JSON.stringify(args, null, 2),
        [
          { text: t('chat.deny'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('chat.allow'), onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    });
}

function toUi(msgs: ChatMsg[]): UiMsg[] {
  return msgs.map((m, i) => ({
    id: `h-${i}-${m.ts ?? 0}-${m.role}`,
    role: m.role,
    content: m.content,
    reasoning: m.reasoning,
    ts: m.ts,
    interrupted: m.interrupted,
    stats: m.stats,
  }));
}

/** 每轮遥测：速度 / 首字延迟 / 生成量 / 上下文占用 */
function fmtStats(i18n: TFn, st: LoopTelemetry): string {
  const parts: string[] = [];
  if (st.tokensPerSec > 0) {
    parts.push(`${st.tokensPerSec.toFixed(1)} tok/s`);
  }
  if (st.ttftMs !== null) {
    parts.push(i18n('chat.stats.ttft', { s: (st.ttftMs / 1000).toFixed(1) }));
  }
  if (st.predicted > 0) {
    parts.push(`${st.predicted} tok`);
  }
  if (st.cachedTokens > 0) {
    parts.push(i18n('chat.stats.cached', { n: st.cachedTokens }));
  }
  if (st.rounds > 1) {
    parts.push(i18n('chat.stats.rounds', { n: st.rounds }));
  }
  if (st.contextFull) {
    parts.push(i18n('chat.stats.contextFull'));
  } else if (st.truncated) {
    parts.push(i18n('chat.stats.truncated'));
  }
  return parts.join(' · ');
}

export default function ChatScreen({
  modelPath,
  lang = 'zh',
  onPickModels,
  onOpenDrawer,
  onOpenSettings,
  prefsVersion = 0,
  activeSession,
  onSessionChange,
}: ChatScreenProps) {
    const i18n = useT();
  const t = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
const [loading, setLoading] = useState(false);
  const [loadPct, setLoadPct] = useState(0);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState('');
  const [toolWarning, setToolWarning] = useState('');
  const [contextWarn, setContextWarn] = useState<{ used: number; total: number } | null>(null);
  const prefsRef = useRef<PrefsExt | null>(null);
  const listRef = useRef<FlatList>(null);
  const busyRef = useRef(false);
  const stopRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  /** 引擎状态变化（加载/卸载）后强制重算「已加载」 */
  const [engineTick, setEngineTick] = useState(0);
  /** 加大上下文面板 */
  const [ctxPick, setCtxPick] = useState(false);
  const [ctxBusy, setCtxBusy] = useState(false);
  /** 正在朗读的消息 id（null = 没在念） */
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  /** 附件：文本附件或图片（图片只有视觉模型能用） */
  const [attachment, setAttachment] = useState<Attachment | null>(null);

  // 切换会话 / 设置变更 → 载入消息（只在「换会话」时重置，不跟随 messages 变化，否则会打断流式）
  useEffect(() => {
    setMessages(toUi(activeSession?.messages ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id, prefsVersion]);

  useEffect(() => {
    loadPrefsExt().then(p => {
      prefsRef.current = p;
    });
  }, [prefsVersion]);

  /** 当前引擎里加载的是不是这个模型（避免"已加载"撒谎） */
  const readyThisPath = isLoaded() && getLoadedPath() === modelPath;
  void engineTick;

  const patchMsg = useCallback((id: string, patch: Partial<UiMsg>) => {
    setMessages(m => m.map(x => (x.id === id ? { ...x, ...patch } : x)));
  }, []);

  const onLoad = useCallback(async () => {
    if (!modelPath || loading) {
      return;
    }
    setLoading(true);
    setLoadPct(0);
    setNotice('');
    try {
      const prefs = prefsRef.current ?? (await loadPrefsExt());
      prefsRef.current = prefs;
      const rp = resolveParams(prefs, modelPath);
      // 先自己看一眼文件：坏文件/没下完时原生只会抛一句 Unknown error
      const check = await checkModelFile(modelPath);
      if (!check.ok) {
        console.warn('[load] precheck blocked', check.kind, check.reason);
        setStatus(`${check.reason} · ${check.nextSteps}`);
        setNotice(`${check.reason} —— ${check.nextSteps}`);
        return;
      }
      // 视觉：模型旁边有唯一投影器就一并加载（找不到就纯文本，不猜）
      const projector = await findProjector(modelPath);
      await loadModel(
        modelPath,
        // 进度回调是从原生侧调过来的：抛异常会被 llama.rn 兜成 "Unknown error"，
        // 所以这里只做最简单的状态更新，并自己兜住
        p => {
          try {
            setLoadPct(Math.round(p * 100));
          } catch {
            /* 忽略 */
          }
        },
        {
          nCtx: rp.nCtx,
          nGpuLayers: rp.nGpuLayers,
          nThreads: rp.nThreads,
          mmproj: projector,
        },
      );
      setEngineTick(t => t + 1);
      const be = backendInfo();
      const backend = be
        ? be.kind === 'gpu'
          ? be.devices
            ? i18n('chat.backend.gpuDevices', { dev: be.devices })
            : i18n('chat.backend.gpu')
          : be.reason
            ? `${i18n('chat.backend.cpu')}（${i18n('chat.backend.noGpu', { reason: be.reason })}）`
            : i18n('chat.backend.cpu')
        : '';
      const vision = isVisionEnabled()
        ? i18n('chat.visionOn')
        : projector
          ? i18n('chat.visionFailedShort')
          : '';
      setStatus(`${i18n('chat.loaded')}${backend ? ` · ${backend}` : ''}${vision ? ` · ${vision}` : ''}`);
      if (projector && !isVisionEnabled()) {
        setNotice(i18n('chat.visionFailedNotice'));
      }
      setToolWarning(
        toolSupport() === 'no'
          ? i18n('chat.toolUnsupported')
          : '',
      );
      const issue = takeLoadIssue();
      if (issue) {
        setNotice(i18n('chat.dataIssue', { msg: issue }));
      }
    } catch (e) {
      setEngineTick(t => t + 1);
      console.warn('[load] failed', e);
      setStatus(i18n('chat.loadFailed', { msg: String(e) }));
      const hint = loadFailureHint();
      setNotice(`${hint.reason}
${hint.nextSteps}`);
    } finally {
      setLoading(false);
    }
  }, [modelPath, loading, i18n]);

  const onUnload = useCallback(async () => {
    await unloadModel();
    setEngineTick(t => t + 1);
    setStatus(i18n('chat.unloaded'));
    setToolWarning('');
  }, [, i18n]);

  const onHeaderButton = useCallback(() => {
    if (!readyThisPath) {
      onLoad();
      return;
    }
    Alert.alert(i18n('chat.loaded'), modelPath.split('/').pop() ?? modelPath, [
      { text: i18n('chat.reload'), onPress: onLoad },
      { text: i18n('chat.unload'), style: 'destructive', onPress: onUnload },
      { text: i18n('common.cancel'), style: 'cancel' },
    ]);
  }, [readyThisPath, onLoad, onUnload, modelPath, i18n]);

  /** 会话落盘：只更新消息，标题/置顶以盘上为准（不回滚用户操作） */
  const persist = useCallback(
    async (list: UiMsg[]) => {
      if (!activeSession) {
        return;
      }
      const clean = toPersistable(
        list.map(m => ({
          role: m.role,
          content: m.content,
          ts: m.ts,
          reasoning: m.reasoning,
          interrupted: m.interrupted,
          stats: m.stats,
          streaming: m.streaming,
        })),
      );
      const { session } = await persistSessionMessages(activeSession.id, clean);
      if (!session) {
        setNotice(i18n('chat.sessionGone'));
        return;
      }
      onSessionChange(session);
    },
    [activeSession, onSessionChange, i18n],
  );

  /** 朗读一条助手消息（再点一次 = 停） */
  const speakMessage = useCallback(
    async (id: string, text: string) => {
      if (speakingId === id) {
        await stopSpeaking();
        setSpeakingId(null);
        return;
      }
      await stopSpeaking();
      setSpeakingId(id);
      const r = await speakText(text, {
        lang: speechLangFor(lang),
        onDone: () => setSpeakingId(cur => (cur === id ? null : cur)),
      });
      if (!r.ok) {
        setSpeakingId(null);
        setNotice(`${r.reason} · ${r.nextSteps}`);
      }
    },
    [lang, speakingId],
  );

  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text || busyRef.current || !readyThisPath) {
      return;
    }
    void stopSpeaking();
    setSpeakingId(null);
    setInput('');
    busyRef.current = true;
    stopRef.current = false;
    setBusy(true);
    setStopping(false);
    setStatus('');
    const sentAttachment = attachment;
    let userContent = text;
    if (sentAttachment) {
      userContent = attachmentMarker(text, sentAttachment);
      setAttachment(null);
    }
    const now = Date.now();
    const userMsg: UiMsg = {
      id: `u-${now}`,
      role: 'user',
      content: userContent,
      ts: now,
      imagePath: sentAttachment?.imagePath,
    };
    const assistantId = `a-${now}`;
    setMessages(m => [
      ...m,
      userMsg,
      { id: assistantId, role: 'assistant', content: '', streaming: true, ts: now },
    ]);

    const prefs = prefsRef.current ?? (await loadPrefsExt());
    /** 这一轮真正生效的参数（全局 + 当前模型的覆盖） */
    const rp = resolveParams(prefs, modelPath);
    const activePal = prefs.pals.find(x => x.id === prefs.activePalId);
    const sysPrompt = activePal?.systemPrompt || prefs.systemPrompt;
    // 本轮用户消息：带图片的要发多模态部件（图片本身不进历史，历史里只留标记）
    const turnContent = buildUserContent(text, sentAttachment);
    const history: AgentMsg[] = [
      { role: 'system', content: sysPrompt },
      ...[...messages].map(m => ({ role: m.role, content: m.content }) as AgentMsg),
      { role: 'user', content: turnContent },
    ];

    try {
      const ctx = getContext();
      if (!ctx) {
        throw new Error(i18n('chat.noModel'));
      }
      const res = await runAgentLoop(ctx, history, {
        params: {
          temperature: rp.temperature,
          topP: rp.topP,
          topK: rp.topK,
          minP: rp.minP,
          penaltyRepeat: rp.penaltyRepeat,
          seed: rp.seed,
          nPredict: rp.nPredict,
          enableThinking: rp.enableThinking,
          nCtx: rp.nCtx,
        },
        shouldStop: () => stopRef.current,
        onContent: text => {
          patchMsg(assistantId, { content: text });
        },
        onReasoning: text => {
          patchMsg(assistantId, { reasoning: text });
        },
        onToolStart: name => setStatus(i18n('chat.toolRunning', { name })),
        onToolEnd: (name, ok) =>
          setStatus(ok ? i18n('chat.toolDone', { name }) : i18n('chat.toolFailed', { name })),
        askConfirm: makeAskConfirm(i18n),
        log: l => console.log(`[agent] ${l}`),
      });

      const stats = fmtStats(i18n, res.telemetry);
      const finalMsg: UiMsg = {
        id: assistantId,
        role: 'assistant',
        content: res.text,
        reasoning: res.reasoning || undefined,
        ts: now,
        interrupted: res.telemetry.interrupted,
        stats,
      };
      // 一次性替换整份列表（不在 updater 里做副作用，避免 React 渲染期 setState 警告）
      setMessages([...messages, userMsg, finalMsg]);
      await persist([...messages, userMsg, finalMsg]);
      if (prefs.ttsAutoSpeak && res.text) {
        void speakMessage(assistantId, res.text);
      }
      if (res.telemetry.contextFull || res.telemetry.promptTokens > rp.nCtx * 0.8) {
        setContextWarn({ used: res.telemetry.promptTokens, total: rp.nCtx });
      } else {
        setContextWarn(null);
      }
      setStatus('');
    } catch (err) {
      // 真实错误先打日志；提示字符串在闭包外算好（不在 updater 里读 catch 变量）
      console.warn('[agent] turn failed', err);
      const failMsg: UiMsg = {
        id: assistantId,
        role: 'assistant',
        content: i18n('chat.error', { msg: String(err) }),
        ts: now,
      };
      setMessages([...messages, userMsg, failMsg]);
      await persist([...messages, userMsg, failMsg]);
      setStatus('');
    } finally {
      busyRef.current = false;
      stopRef.current = false;
      setBusy(false);
      setStopping(false);
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [input, messages, readyThisPath, persist, patchMsg, attachment, modelPath, i18n, speakMessage]);

  const pickAttachment = useCallback(async () => {
    try {
      const [file] = await DocumentPicker.pick({
        allowMultiSelection: false,
        copyTo: 'documentDirectory',
        type: [DocumentPicker.types.allFiles],
      });
      const uri = file.fileCopyUri ?? file.uri;
      if (!uri) {
        return;
      }
      const path = uri.startsWith('file://') ? uri.slice(7) : uri;
      const name = file.name ?? i18n('chat.attachment');
      // 图片：只有视觉模型（加载了投影器）才收
      if (isImageFile(name)) {
        if (!isVisionEnabled()) {
          setStatus(i18n('chat.needVision'));
          return;
        }
        setAttachment({ name, imagePath: path });
        return;
      }
      // 只读文本类附件；二进制给个提示
      const bin = /\.(gguf|pdf|zip|mp[34]|apk|so)$/i.test(name);
      if (bin) {
        setStatus(i18n('chat.binaryAttach', { name }));
        return;
      }
      const info = await RNFS.stat(path).catch(() => null);
      if (info && Number(info.size) > 2 * 1024 * 1024) {
        setStatus(i18n('chat.attachTooBig', { name }));
        return;
      }
      const content = (await RNFS.readFile(path, 'utf8').catch(async () => {
        return await RNFS.readFile(path, 'base64').then(() => '');
      })).slice(0, 24000);
      if (!content) {
        setStatus(i18n('chat.attachUnreadable'));
        return;
      }
      setAttachment({ name, content });
    } catch (e) {
      if (!isPickCancel(e)) {
        setStatus(String(e));
      }
    }
  }, [, i18n]);

  // 离开页面时别让语音继续念
  useEffect(() => {
    return () => {
      void stopSpeaking();
    };
  }, []);

  const onStop = useCallback(async () => {
    stopRef.current = true;
    setStopping(true);
    setStatus(i18n('chat.stopping'));
    await stopGenerate();
  }, [, i18n]);

  /** 原地加大上下文：写进「这个模型」的专属参数后重载，对话不丢 */
  const applyContext = useCallback(
    async (nCtx: number) => {
      setCtxBusy(true);
      setLoading(true);
      setLoadPct(0);
      try {
        const prefs = prefsRef.current ?? (await loadPrefsExt());
        const key = modelKey(modelPath);
        const next: PrefsExt = {
          ...prefs,
          // 上下文天然是「每个模型」的事：写到模型的专属参数里，不污染全局
          modelParams: {
            ...prefs.modelParams,
            [key]: { ...(prefs.modelParams?.[key] ?? {}), nCtx },
          },
        };
        await savePrefsExt(next);
        prefsRef.current = next;
        await unloadModel();
        await loadModel(modelPath, p => setLoadPct(Math.round(p * 100)), {
          nCtx,
          nGpuLayers: next.nGpuLayers,
          nThreads: next.nThreads,
        });
        setEngineTick(t => t + 1);
        setContextWarn(null);
        setCtxPick(false);
        setNotice(i18n('chat.ctxChanged', { n: nCtx }));
      } catch (e) {
        setNotice(i18n('chat.ctxChangeFailed', { msg: String(e) }));
      } finally {
        setCtxBusy(false);
        setLoading(false);
      }
    },
    [modelPath, i18n],
  );

  const SUGGESTED: MsgKey[] = ['chat.suggest1', 'chat.suggest2', 'chat.suggest3', 'chat.suggest4'];

  const shortPath = modelPath ? modelPath.split('/').pop() : '';
  const showGuide = !readyThisPath;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable style={styles.iconBtn} onPress={onOpenDrawer} hitSlop={8}>
          <Text style={styles.iconText}>☰</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {activeSession?.title && !isPlaceholderTitle(activeSession.title, i18n)
            ? activeSession.title
            : i18n('chat.title')}
        </Text>
        <View style={styles.headerRight}>
          {modelPath ? (
            <Pressable
              style={[styles.loadBtnSmall, readyThisPath && { backgroundColor: t.surfaceAlt }]}
              onPress={onHeaderButton}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={t.accentText} size="small" />
              ) : (
                <Text style={styles.btnText}>{readyThisPath ? i18n('chat.loadedBtn') : i18n('chat.load')}</Text>
              )}
            </Pressable>
          ) : (
            <Pressable style={styles.loadBtnSmall} onPress={onPickModels}>
              <Text style={styles.btnText}>{i18n('chat.pickModel')}</Text>
            </Pressable>
          )}
        </View>
      </View>
      {(loading || status) && (
        <Text style={styles.status}>
          {loading ? i18n('common.loading', { pct: loadPct }) : status}
        </Text>
      )}
      {notice ? (
        <View style={styles.noticeBar}>
          <Text style={styles.noticeText} numberOfLines={2}>{notice}</Text>
          <Pressable onPress={() => setNotice('')}>
            <Text style={styles.noticeClose}>×</Text>
          </Pressable>
        </View>
      ) : null}
      {toolWarning ? (
        <View style={styles.warnBar}>
          <Text style={styles.warnText} numberOfLines={2}>{toolWarning}</Text>
          <Pressable onPress={() => setToolWarning('')}>
            <Text style={styles.noticeClose}>×</Text>
          </Pressable>
        </View>
      ) : null}
      {contextWarn ? (
        <View style={styles.warnBar}>
          <Text style={styles.warnText}>
            上下文已用 ~{contextWarn.used}/{contextWarn.total} token，继续聊可能会答非所问
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => setCtxPick(true)}>
              <Text style={styles.warnAction}>{i18n('chat.moreContext')}</Text>
            </Pressable>
            {onOpenSettings ? (
              <Pressable onPress={onOpenSettings}>
                <Text style={styles.warnAction}>{i18n('nav.settings')}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => setContextWarn(null)}>
              <Text style={styles.noticeClose}>×</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {showGuide && messages.length === 0 ? (
        <View style={styles.guide}>
          <Text style={styles.mascot}>🛸</Text>
          <Text style={styles.guideTitle}>{i18n('chat.guideTitle')}</Text>
          <Text style={styles.guideBody}>{i18n('chat.guideBody')}</Text>
          <Pressable style={styles.ctaBtn} onPress={onPickModels}>
            <Text style={styles.ctaText}>{i18n('chat.pickModelCta')}</Text>
          </Pressable>
          {modelPath ? (
            <Pressable style={[styles.ctaBtn, styles.ctaSecondary]} onPress={onLoad}>
              {loading ? (
                <ActivityIndicator color={t.ctaText} size="small" />
              ) : (
                <Text style={[styles.ctaText, { color: t.ctaText }]}>
                  {i18n('chat.loadDownloaded')}
                  {shortPath ? ` (${shortPath})` : ''}
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.list}
          data={messages}
          keyExtractor={m => m.id}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View
              style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.botBubble]}
            >
              {item.role === 'assistant' ? (
                <ThinkingBlock
                  reasoning={item.reasoning ?? ''}
                  streaming={item.streaming}
                  hasContent={!!item.content}
                />
              ) : null}
              {item.imagePath ? (
                <Image
                  source={{ uri: `file://${item.imagePath}` }}
                  style={styles.bubbleImage}
                  resizeMode="cover"
                />
              ) : null}
              <Text style={styles.bubbleText}>
                {item.content}
                {item.streaming ? ' ▌' : ''}
              </Text>
              {item.role === 'assistant' && item.interrupted ? (
                <Text style={styles.metaText}>{i18n('chat.interrupted')}</Text>
              ) : null}
              {item.role === 'assistant' && (item.stats || item.content) ? (
                <View style={styles.metaRow}>
                  {item.stats ? <Text style={styles.metaText}>{item.stats}</Text> : null}
                  {item.content ? (
                    <Pressable
                      onPress={() => speakMessage(item.id, item.content)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={
                        speakingId === item.id ? i18n('chat.stopSpeak') : i18n('chat.speak')
                      }
                    >
                      <Text style={styles.speakBtn}>{speakingId === item.id ? '■' : '▶'}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          )}
          ListEmptyComponent={
            <View style={{ marginTop: 32 }}>
              <Text style={styles.empty}>{i18n('chat.empty')}</Text>
              <View style={styles.suggestWrap}>
                {SUGGESTED.map(k => (
                  <Pressable
                    key={k}
                    style={styles.suggestChip}
                    onPress={() => setInput(i18n(k))}
                  >
                    <Text style={styles.suggestText}>{i18n(k)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
        />
      )}

      {attachment && (
        <View style={styles.attachBar}>
          <Text style={styles.attachText} numberOfLines={1}>
            {attachment.imagePath ? '📷' : '📎'} {attachment.name}
          </Text>
          <Pressable onPress={() => setAttachment(null)}>
            <Text style={{ color: t.dangerText, paddingHorizontal: 8 }}>×</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.inputBar}>
        <Pressable style={styles.attachBtn} onPress={pickAttachment} hitSlop={6}>
          <Text style={{ color: t.accentSoft, fontSize: 20 }}>＋</Text>
        </Pressable>
        <TextInput
          style={[styles.input, !readyThisPath && styles.inputDisabled]}
          placeholder={readyThisPath ? i18n('chat.placeholder') : i18n('chat.inputDisabled')}
          placeholderTextColor={t.textDim}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={onSend}
          editable={readyThisPath}
          multiline
        />
        {busy ? (
          <Pressable
            style={[styles.sendBtn, styles.stopBtn, stopping && styles.btnDisabled]}
            onPress={onStop}
            disabled={stopping}
          >
            <Text style={styles.btnText}>{stopping ? '…' : '■'}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.sendBtn, (!input.trim() || !readyThisPath) && styles.btnDisabled]}
            onPress={onSend}
            disabled={!input.trim() || !readyThisPath}
          >
            <Text style={styles.btnText}>{i18n('chat.send')}</Text>
          </Pressable>
        )}
      </View>

      <Modal
        visible={ctxPick}
        transparent
        animationType="fade"
        onRequestClose={() => setCtxPick(false)}
      >
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{i18n('chat.ctxSheetTitle')}</Text>
            <Text style={styles.sheetHint}>{i18n('chat.ctxSheetHint')}</Text>
            {[4096, 8192, 16384, 32768].map(n => {
              const current = (prefsRef.current?.nCtx ?? 4096) === n;
              return (
                <Pressable
                  key={n}
                  style={[styles.ctxRow, current && styles.ctxRowActive]}
                  disabled={ctxBusy}
                  onPress={() => applyContext(n)}
                >
                  <Text style={styles.ctxTokens}>
                    {i18n('chat.ctxTokens', { n })}
                    {current ? i18n('chat.ctxCurrent') : ''}
                  </Text>
                  <Text style={styles.ctxRam}>
                    {i18n('chat.ctxCacheGb', { gb: ((n / 1000) * 0.016).toFixed(1) })}
                  </Text>
                </Pressable>
              );
            })}
            {ctxBusy ? <ActivityIndicator color={t.accentSoft} style={{ marginTop: 10 }} /> : null}
            <Pressable
              style={[styles.sendBtn, { marginTop: 12, backgroundColor: t.surfaceAlt }]}
              disabled={ctxBusy}
              onPress={() => setCtxPick(false)}
            >
              <Text style={styles.btnText}>
                {ctxBusy ? i18n('chat.ctxReloading') : i18n('common.cancel')}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 6,
  },
  iconBtn: { padding: 8 },
  iconText: { color: t.text, fontSize: 20 },
  headerTitle: { flex: 1, color: t.text, fontSize: 16, fontWeight: '600' },
  headerRight: { maxWidth: '42%' },
  loadBtnSmall: {
    backgroundColor: t.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  btnText: { color: t.accentText, fontWeight: '600', fontSize: 12 },
  btnDisabled: { opacity: 0.4 },
  status: { color: t.accentSoft, paddingHorizontal: 16, paddingBottom: 6, fontSize: 12 },
  noticeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: t.noticeBg,
  },
  noticeText: { flex: 1, color: t.noticeText, fontSize: 12 },
  noticeClose: { color: t.textDim, fontSize: 16, paddingHorizontal: 6 },
  warnBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: t.warnBg,
  },
  warnText: { flex: 1, color: t.warnText, fontSize: 12 },
  warnAction: { color: t.accentSoft, fontSize: 12, paddingHorizontal: 6, fontWeight: '600' },
  guide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  mascot: { fontSize: 72, marginBottom: 18 },
  guideTitle: {
    color: t.text,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
  },
  guideBody: {
    color: t.textDim,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 28,
  },
  ctaBtn: {
    backgroundColor: t.ctaBg,
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 48,
    marginBottom: 12,
    minWidth: 220,
    alignItems: 'center',
  },
  ctaSecondary: { backgroundColor: t.accent },
  ctaText: { color: t.ctaText, fontSize: 15, fontWeight: '600' },
  list: { flex: 1, paddingHorizontal: 10 },
  empty: { color: t.textFaint, textAlign: 'center', marginTop: 48 },
  bubble: { maxWidth: '88%', borderRadius: 12, padding: 12, marginVertical: 4 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: t.accent },
  botBubble: { alignSelf: 'flex-start', backgroundColor: t.surface },
  bubbleText: { color: t.text, fontSize: 15, lineHeight: 21 },
  bubbleImage: {
    width: 200,
    height: 150,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: t.ctaText,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  metaText: { color: t.textFaint, fontSize: 11 },
  speakBtn: { color: t.accentSoft, fontSize: 13, paddingHorizontal: 2 },
  inputBar: {
    flexDirection: 'row',
    padding: 10,
    gap: 8,
    alignItems: 'flex-end',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.border,
    backgroundColor: t.bgAlt,
  },
  input: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: t.text,
    fontSize: 15,
    maxHeight: 100,
  },
  inputDisabled: { opacity: 0.55 },
  stopBtn: { backgroundColor: t.danger },
  attachBtn: {
    padding: 10,
    backgroundColor: t.surface,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
    marginBottom: 6,
    backgroundColor: t.surface,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  attachText: { flex: 1, color: t.accentSoft, fontSize: 12 },
  suggestWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 24,
    marginTop: 18,
  },
  suggestChip: {
    backgroundColor: t.surface,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  suggestText: { color: t.accentSoft, fontSize: 12 },
  sendBtn: {
    backgroundColor: t.accent,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sheetWrap: { flex: 1, backgroundColor: t.scrim, justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: t.surface, borderRadius: 16, padding: 20 },
  sheetTitle: { color: t.text, fontSize: 16, fontWeight: '700', marginBottom: 8 },
  sheetHint: { color: t.textDim, fontSize: 12, lineHeight: 18, marginBottom: 14 },
  ctxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: t.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  ctxRowActive: { backgroundColor: t.accent },
  ctxTokens: { color: t.text, fontSize: 14, fontWeight: '600' },
  ctxRam: { color: t.textMid, fontSize: 11 },
});
