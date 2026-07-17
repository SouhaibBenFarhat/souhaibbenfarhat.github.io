import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpRight, Bot, Check, ChevronDown, Cpu, Info, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react';

import { API } from '../../lib/api';
import { isInternal } from '../../lib/internal';
import { createQueryClient } from '../../lib/queries/client';
import { useConversation, type ChatUsage, type Message } from '../../lib/queries/useConversation';
import { useDeleteConversation } from '../../lib/queries/useDeleteConversation';

// Fallback labels for backends that don't send a per-frame `label` yet. The stream now carries a
// human-readable `label` on each tool frame (ChatToolFrame), which is preferred; this map only
// catches an older backend, and 'working' catches a tool it has no entry for.
const TOOL_LABELS: Record<string, string> = {
  get_facts: 'loading facts',
  get_cv: 'reading the CV',
  list_documents: 'browsing documents',
  read_document: 'reading a document',
  list_github_projects: 'exploring projects',
  get_repo_readme: 'reading the project',
};

// LiteLLM model ids → friendly names, for the models the backend actually has configured. An id
// that isn't listed here shows verbatim (see modelLabel), so a new/unknown model is still named
// honestly rather than hidden behind a generic label — just add it here to prettify it.
const MODEL_NAMES: Record<string, string> = {
  'zai/glm-4.7-flash': 'GLM 4.7 Flash',
  'mistral/mistral-small-latest': 'Mistral Small',
  'mistral/open-mistral-nemo': 'Mistral Nemo',
};
function modelLabel(id: string): string {
  return MODEL_NAMES[id] ?? id; // unknown model → show its raw id, not a static fallback
}

// A tool step the assistant took while answering. Shown in the message as it happens (a pulsing
// dot) and kept afterwards as a record of what it did (a check). `done` flips on the tool's `end`
// frame. Attached to the message locally — the restore endpoint doesn't persist tool steps, so
// they survive the turn but not a reload.
type ToolStep = { tool: string; label: string; done: boolean };
// `errored` marks a turn whose stream failed, so a Retry control renders under it. The error text
// itself lives in `content` (surfaced inline), so it survives in the message list like any reply.
type ChatMessage = Message & { tools?: ToolStep[]; errored?: boolean; model?: string };

const WELCOME =
  "Hey 👋 I'm Souhaib's assistant. Ask me about his projects, experience, skills, or " +
  'availability — I answer straight from his CV and GitHub. What would you like to know?';

const SUGGESTIONS = [
  'What did he build recently?',
  'Is he open to remote roles?',
  "What's his experience with AI?",
];

const DEFAULT_WIDTH = 460;
const MIN_WIDTH = 380;

// Smooth streaming: instead of painting each network burst instantly, buffer the
// incoming tokens and reveal them character-by-character at a steady pace. The rate
// speeds up as the buffer grows (so the display never lags far behind), capped so a
// large already-finished response doesn't blast out at once. Tune REVEAL_CPS to taste.
const REVEAL_CPS = 40; // baseline reveal speed (chars/sec) — lower feels slower
const REVEAL_CATCHUP = 1.6; // extra chars/sec per buffered char, to catch up when behind
const REVEAL_MAX_CPS = 200; // ceiling so a big buffered response reveals smoothly, not instantly

// The gauge stays visually neutral until the thread is this full, then warms. The only
// moment the number matters is the one before the chat stops.
const WARM_AT_PCT = 80;

// Render a safe subset of markdown: escape first, then add our own tags only.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function renderMarkdown(src: string): string {
  let s = escapeHtml(src);
  s = s.replace(/```([\s\S]*?)```/g, (_m, c) => `<pre><code>${c.trim()}</code></pre>`);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  s = s.replace(/^[-*] (.+)$/gm, '<span class="sfchat-li">$1</span>');
  return s.replace(/\n/g, '<br>');
}

// Inline error text for the assistant bubble: the friendly message on its own line, and — for a
// backend error frame — the raw technical `detail` in a code block below it, so a multi-line
// provider exception stays legible. `detail` is an owner-only field, which is safe here because the
// whole panel is owner-gated (?internal=1). No detail (or a transport error) → just the message.
function formatStreamError(message: string, detail?: string): string {
  const friendly = `⚠️ ${message}`;
  return detail ? `${friendly}\n\n\`\`\`\n${detail}\n\`\`\`` : friendly;
}

function TypingDots() {
  return (
    <span className="sfchat-dots" aria-label="typing">
      <span />
      <span />
      <span />
    </span>
  );
}

const CONV_KEY = 'chat_conversation_id';
function storedConversationId(): string | null {
  try {
    return typeof window !== 'undefined' ? localStorage.getItem(CONV_KEY) : null;
  } catch {
    return null;
  }
}

// Placeholder bubbles shown while a prior conversation is fetched, so the panel never
// flashes blank and the layout doesn't jump when the messages arrive. Pulse (opacity)
// rather than a moving gradient, to stay within the site's minimalist tokens.
function ChatSkeleton() {
  const rows = [
    { role: 'assistant', lines: 3 },
    { role: 'user', lines: 1 },
    { role: 'assistant', lines: 2 },
    { role: 'user', lines: 2 },
    { role: 'assistant', lines: 3 },
  ];
  return (
    <div className="sfchat-skel" aria-hidden="true">
      {rows.map((r, i) => (
        <div key={i} className={`sfchat-row ${r.role}`}>
          {r.role === 'assistant' && <span className="sfchat-avatar sm sfchat-skel-dot" />}
          <div className={`sfchat-skel-bubble ${r.role}`}>
            {Array.from({ length: r.lines }).map((_, j) => (
              <span key={j} className="sfchat-skel-line" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 940 → "940", 4200 → "4.2k", 20000 → "20k". */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}

// How full the thread's context is. The whole conversation is resent on every turn, so a
// long thread costs more each time and eventually hits its budget — this is the warning
// before that happens, not a spend or a quota (hence "memory", never "tokens remaining").
//
// The denominator is the backend's per-thread budget, not the model's window: against a
// 131k window the bar would sit near-empty forever and read as broken.
//
// Always on screen, so the composer's footer doesn't reflow when the first figures land.
// Until they do, the track sits empty with no numbers: the limit is the backend's to report
// (it's env-tunable), so there is nothing honest to print yet — an empty bar says "not
// measured", a "0 / 20k" would be an invention.
//
// The bar alone can't say what it measures, so it carries a tooltip on hover/focus: what
// the number means, and the exact figures the abbreviated label rounds off. A native
// `title` would be slower, unstyled, and invisible to keyboard users.
function ContextGauge({ usage }: { usage: ChatUsage | null }) {
  const tipId = useId();
  const used = usage?.context_tokens ?? 0;
  const limit = usage?.context_limit ?? 0;
  const known = usage != null && limit > 0;
  const pct = known ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <span className="sfchat-gauge-wrap">
      <span
        className={`sfchat-gauge ${known && pct >= WARM_AT_PCT ? 'warm' : ''}`}
        role="progressbar"
        tabIndex={0}
        aria-label="Conversation memory used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? Math.round(pct) : undefined}
        aria-describedby={tipId}
      >
        <span className="sfchat-gauge-track">
          <span className="sfchat-gauge-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="sfchat-gauge-num">
          {known ? `${formatTokens(used)} / ${formatTokens(limit)}` : '—'}
        </span>
      </span>

      <span className="sfchat-gauge-tip" id={tipId} role="tooltip">
        {known
          ? `Context window: ${used.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')}`
          : 'Context window: —'}
      </span>
    </span>
  );
}

// The AI chat isn't ready for the public yet, so it's gated behind internal/owner mode
// (visit once with `?internal=1`). The panel — with all its hooks and body-shifting
// side effects — only mounts for internal browsers; everyone else renders nothing.
export default function ChatWidget() {
  const [internal, setInternal] = useState(false);
  // Per-mount client, so nothing is cached across mounts (or across tests).
  const [queryClient] = useState(createQueryClient);
  useEffect(() => setInternal(isInternal()), []);
  return internal ? (
    <QueryClientProvider client={queryClient}>
      <ChatPanel />
    </QueryClientProvider>
  ) : null;
}

function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState('');
  // Null until the thread's context size is known — a fresh chat has no figures yet, and a
  // gauge reading 0% would be an invention. Only ever set from what the backend reports.
  const [usage, setUsage] = useState<ChatUsage | null>(null);
  // The id the page loaded with — the restore query's key. Cleared once there's nothing to
  // restore (deleted, or the backend never had it), which disables the query.
  const [storedId, setStoredId] = useState(storedConversationId);
  // A fresh session (no stored id) has nothing to restore, so the welcome is armed straight away.
  const [welcomeArmed, setWelcomeArmed] = useState(storedId == null);
  // Bumped after a delete so the greeting replays even though `welcomeArmed` was already true.
  const [welcomeRun, setWelcomeRun] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Prompts typed while a reply is still streaming. They fire automatically, in order, one per
  // completed turn (see the drain effect below). Shown as a removable list above the composer.
  const [queue, setQueue] = useState<string[]>([]);
  // Measured height of the floating composer bar. The list reserves this much space at its bottom so
  // the newest message rests just above the composer rather than hiding behind it.
  const [barH, setBarH] = useState(0);
  // "Jump to latest" button — shown once the user scrolls up off the bottom (auto-scroll disengaged).
  const [showJump, setShowJump] = useState(false);
  const conversationId = useRef<string | null>(storedId);
  const seeded = useRef(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const revealRaf = useRef<number | null>(null);
  const barRO = useRef<ResizeObserver | null>(null);
  const stuckRef = useRef(true); // is auto-scroll following the bottom? false once the user scrolls up
  const welcomeDone = welcome.length >= WELCOME.length;

  const restore = useConversation(storedId);
  const del = useDeleteConversation();
  const loadingHistory = restore.isLoading; // floored — the skeleton never flashes
  const deleting = del.isDeleting; // floored — "Deleting…" is always readable
  const deleteFailed = del.isError && !deleting;

  /** Forget the stored thread and greet as if this were a first visit. */
  const forget = () => {
    try {
      localStorage.removeItem(CONV_KEY);
    } catch {
      /* ignore */
    }
    conversationId.current = null;
    setStoredId(null);
    setWelcomeArmed(true);
    setUsage(null); // a new thread's context is unknown again, not zero
    setQueue([]); // queued prompts belong to the thread being left, not the fresh one
  };

  // Track the floating composer's height so the list can pad its bottom to match — keeping it in sync
  // as the bar grows (a taller textarea, the queue appearing, the spent panel swapping in). A callback
  // ref re-observes across those element swaps; ResizeObserver is absent under jsdom, so guard it.
  const setBar = useCallback((el: HTMLElement | null) => {
    barRO.current?.disconnect();
    barRO.current = null;
    if (!el) return;
    const measure = () => setBarH(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    barRO.current = new ResizeObserver(measure);
    barRO.current.observe(el);
  }, []);
  useEffect(() => () => barRO.current?.disconnect(), []);

  // Stop the reveal loop if the widget unmounts mid-stream.
  useEffect(() => () => {
    if (revealRaf.current != null) cancelAnimationFrame(revealRaf.current);
  }, []);

  // Auto-grow the composer as lines are added (up to a cap).
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  // Auto-open on every load — start closed, then open so the slide-in animates.
  useEffect(() => {
    const t = window.setTimeout(() => setOpen(true), 140);
    return () => window.clearTimeout(t);
  }, []);

  // Seed the panel from the restored conversation once the query settles and its loading
  // floor has elapsed. An error or an empty thread means there's nothing to show (a 404 —
  // e.g. the free DB was reset) → forget it and greet as a fresh chat. Runs once: later
  // renders must not stomp on messages that streaming has since appended.
  useEffect(() => {
    if (!storedId || seeded.current || loadingHistory) return;
    seeded.current = true;
    const restored = restore.data?.messages ?? [];
    if (restored.length) {
      setMessages(restored);
      setUsage(restore.data?.usage ?? null); // rebuild the gauge, so a reload isn't a blank slate
    } else forget();
  }, [storedId, loadingHistory, restore.data]);

  // Push the page over (desktop) rather than covering it; the panel width is
  // shared with the page via a CSS variable.
  useEffect(() => {
    document.body.classList.toggle('sfchat-pushed', open);
    document.body.style.setProperty('--sfchat-w', `${width}px`);
    return () => document.body.classList.remove('sfchat-pushed');
  }, [open, width]);

  // Drag-to-resize from the left edge.
  useEffect(() => {
    document.body.classList.toggle('sfchat-resizing', resizing);
    if (!resizing) return;
    const onMove = (e: PointerEvent) => {
      const next = window.innerWidth - e.clientX - 16; // 16 = panel's right margin
      setWidth(Math.min(Math.max(next, MIN_WIDTH), Math.min(860, window.innerWidth - 64)));
    };
    const onUp = () => setResizing(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [resizing]);

  // Show the typing indicator for ~2s, then type out the welcome message once — but
  // only for a fresh chat. A restored conversation shows its history, not the greeting.
  useEffect(() => {
    if (!welcomeArmed) return;
    let i = 0;
    let interval: number | undefined;
    const start = window.setTimeout(() => {
      interval = window.setInterval(() => {
        i += 2;
        setWelcome(WELCOME.slice(0, i));
        if (i >= WELCOME.length) window.clearInterval(interval);
      }, 16);
    }, 2000);
    return () => {
      window.clearTimeout(start);
      if (interval) window.clearInterval(interval);
    };
  }, [welcomeArmed, welcomeRun]);

  useEffect(() => {
    if (!stuckRef.current) return; // the user scrolled up — don't drag them back to the bottom
    // While streaming, the text grows a few chars per frame — an instant scroll pins
    // to the bottom and reads as one continuous glide. Smooth-scrolling here would
    // restart its animation every frame and stutter. Use smooth only for one-off jumps.
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: busy ? 'auto' : 'smooth',
    });
  }, [messages, status, welcome, open, busy]);

  // Auto-scroll follows the newest content only while the user is at the bottom. Scrolling up — to
  // re-read something while the agent streams, say — disengages it, so tokens stop yanking the view
  // down; scrolling back to the bottom re-engages it. `stuckRef` is a ref so it costs no re-render per
  // frame; `showJump` only flips React state when the boundary is actually crossed.
  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    stuckRef.current = atBottom;
    setShowJump(!atBottom);
  };

  /** Re-engage auto-scroll and glide to the newest message. */
  const jumpToLatest = () => {
    const el = listRef.current;
    if (!el) return;
    stuckRef.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  // Dismiss the confirm popover on Escape or a click outside it.
  useEffect(() => {
    if (!confirmingDelete) return;
    const dismiss = () => {
      setConfirmingDelete(false);
      del.reset();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    const onDown = (e: PointerEvent) => {
      if (!confirmRef.current?.contains(e.target as Node)) dismiss();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [confirmingDelete]);

  // Reset once the delete has succeeded *and* its loading floor has elapsed. Resetting the
  // moment the request resolves would unmount the confirm before "Deleting…" could be read,
  // which is exactly the flash the floor exists to prevent. A failure leaves everything in
  // place: the privacy page promises the data is really gone, so the thread stays until the
  // backend confirms it.
  useEffect(() => {
    if (!del.isSuccess || deleting) return;
    forget();
    setMessages([]);
    setStatus(null);
    setConfirmingDelete(false);
    setWelcome('');
    setWelcomeRun((n) => n + 1); // replay the greeting, as on a first visit
    del.reset();
  }, [del.isSuccess, deleting]);

  // Execute one streaming turn. Doesn't touch the composer or the queue — the caller (a direct send,
  // a retry, or the queue drain) owns those. Only ever invoked when the agent is free.
  async function streamTurn(text: string) {
    text = text.trim();
    if (!text || usage?.exhausted) return;
    setConfirmingDelete(false);
    setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '', tools: [] }]);
    setBusy(true);
    // No 'thinking' status: the empty assistant bubble already shows the typing dots, and a status
    // line here would just duplicate it. The status line is reserved for the cold-start notice below.
    setStatus(null);

    const setLastAssistant = (updater: (prev: string) => string) =>
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, role: 'assistant', content: updater(last.content) };
        return copy;
      });

    // Append a tool step to the current assistant message (a tool `start` frame).
    const addToolStep = (tool: string, label: string) =>
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, tools: [...(last.tools ?? []), { tool, label, done: false }] };
        return copy;
      });

    // Mark the most recent still-running step for this tool as done (a tool `end` frame). Matching
    // the last open one — not the first — so a tool called twice in a turn closes in order.
    const finishToolStep = (tool: string) =>
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        const tools = (last.tools ?? []).slice();
        for (let i = tools.length - 1; i >= 0; i--) {
          if (tools[i].tool === tool && !tools[i].done) {
            tools[i] = { ...tools[i], done: true };
            break;
          }
        }
        copy[copy.length - 1] = { ...last, tools };
        return copy;
      });

    // Record which model answered this turn (a ChatModelFrame, sent once before the reply). Kept on
    // the message so the label persists for the session — the restore endpoint doesn't store it.
    const setLastModel = (model: string) =>
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, model };
        return copy;
      });

    // Close any step still marked running when the turn ends. Normally every tool got its `end`
    // frame before the text streamed, so this is a no-op; it just stops a spinner outliving the
    // turn if the stream is cut short or errors mid-tool.
    const closeOpenTools = () =>
      setMessages((m) => {
        const last = m[m.length - 1];
        if (!last?.tools?.some((t) => !t.done)) return m;
        const copy = [...m];
        copy[copy.length - 1] = { ...last, tools: last.tools.map((t) => (t.done ? t : { ...t, done: true })) };
        return copy;
      });

    // Mark the current assistant turn as failed, so a Retry control renders under its bubble.
    const markLastErrored = () =>
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, errored: true };
        return copy;
      });

    // --- Smooth reveal: buffer incoming tokens and paint them at a steady pace ---
    let pending = ''; // tokens received but not yet shown on screen
    let netDone = false; // the network stream has finished
    let carry = 0; // fractional-character accumulator across frames
    let lastTick = 0;

    const finish = () => {
      revealRaf.current = null;
      closeOpenTools();
      setBusy(false);
      setStatus(null);
    };

    const drain = (now: number) => {
      if (!lastTick) lastTick = now;
      const dt = Math.min((now - lastTick) / 1000, 0.05); // clamp long gaps (tab switches)
      lastTick = now;
      if (pending.length) {
        const cps = Math.min(REVEAL_MAX_CPS, REVEAL_CPS + pending.length * REVEAL_CATCHUP);
        carry += cps * dt;
        const n = Math.floor(carry);
        if (n > 0) {
          carry -= n;
          const chunk = pending.slice(0, n);
          pending = pending.slice(n);
          setLastAssistant((prev) => prev + chunk);
        }
      }
      if (pending.length) {
        revealRaf.current = requestAnimationFrame(drain);
      } else if (netDone) {
        finish(); // fully caught up and the stream is over
      } else {
        revealRaf.current = null; // idle until the next token arrives
      }
    };

    const ensureDraining = () => {
      if (revealRaf.current == null) {
        lastTick = 0;
        revealRaf.current = requestAnimationFrame(drain);
      }
    };

    const requestBody = JSON.stringify({ message: text, conversation_id: conversationId.current });

    // The free-tier backend sleeps; a cold start returns 502/503 (with no CORS
    // headers, so the browser reports it as a CORS/network error). Retry while it wakes.
    const openStream = async () => {
      const maxAttempts = 6;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await fetch(`${API}/chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody,
          });
          if ([502, 503, 504].includes(res.status) && attempt < maxAttempts) {
            setStatus('waking the assistant up…');
            await new Promise((r) => setTimeout(r, 6000));
            continue;
          }
          return res;
        } catch (e) {
          if (attempt >= maxAttempts) throw e;
          setStatus('waking the assistant up…');
          await new Promise((r) => setTimeout(r, 6000));
        }
      }
      throw new Error('unreachable');
    };

    try {
      const res = await openStream();
      if (res.status === 429) throw new Error('You’re sending messages too fast — give it a moment.');

      // A spent thread is refused before the model is ever called, so the answer is a JSON
      // body rather than a stream — there's nothing to read. Distinct from the 429 above:
      // waiting doesn't help, only a new chat does.
      if (res.status === 403) {
        const body = await res.json().catch(() => null);
        if (body?.usage) setUsage(body.usage);
        else setUsage((u) => (u ? { ...u, exhausted: true } : u));
        // The turn never reached the model, so the stored thread has no record of it. Drop
        // the optimistic pair rather than show a turn that a reload would silently erase.
        setMessages((m) => m.slice(0, -2));
        finish();
        return;
      }

      if (!res.ok || !res.body) throw new Error('Sorry, I’m having trouble right now.');
      // Connected — clear any 'waking the assistant up…' notice. The typing dots carry it from here
      // until the first tool or token arrives.
      setStatus(null);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.replace(/^data: /, '').trim();
          if (!line) continue;
          const data = JSON.parse(line);
          if (data.conversation_id) {
            conversationId.current = data.conversation_id;
            localStorage.setItem('chat_conversation_id', data.conversation_id);
          }
          // Tool steps now render inside the message (a pulsing chip that resolves to a check),
          // so they persist past the turn. Clear the transient status line — the chip is the
          // live indicator — and prefer the backend's human-readable label over the local map.
          if (data.tool && data.status === 'start') {
            setStatus(null);
            addToolStep(data.tool, data.label ?? TOOL_LABELS[data.tool] ?? 'Working…');
          }
          if (data.tool && data.status === 'end') finishToolStep(data.tool);
          // Names the model answering this turn (sent once, before the reply). Kept on the message
          // and shown as a small caption; absent when the provider didn't report a model.
          if (data.model) setLastModel(data.model);
          // One frame per turn, just before `done`. It carries the thread's context size as
          // of now — it already includes every earlier turn, so it replaces the last value
          // rather than adding to it. Absent when the provider reported no usage: keep what
          // we had, since resetting to zero would claim the context emptied, which is a lie.
          if (data.usage) setUsage(data.usage);
          if (data.text) {
            setStatus(null);
            pending += data.text; // reveal loop paints it at a steady pace
            ensureDraining();
          }
          // A backend error frame. Surface it instead of a generic apology: the friendly `error`
          // message plus the raw `detail` (owner-only) for diagnosis. It can arrive after some
          // answer already streamed, so flush what's buffered and append the error below it rather
          // than replacing it; mark the turn so a Retry control appears.
          if (data.error) {
            const flushed = pending;
            pending = '';
            const errText = formatStreamError(data.error, data.detail);
            setLastAssistant((prev) => {
              const base = prev + flushed;
              return base ? `${base}\n\n${errText}` : errText;
            });
            markLastErrored();
          }
        }
      }
      netDone = true;
      ensureDraining(); // flush whatever's left, then finish()
    } catch (err) {
      if (revealRaf.current != null) {
        cancelAnimationFrame(revealRaf.current);
        revealRaf.current = null;
      }
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      // Transport/other failure — a JS error, not a backend frame, so there's no `detail`. Keep any
      // partial answer and append the message below it; mark the turn so a Retry control appears.
      setLastAssistant((prev) => (prev ? `${prev}\n\n⚠️ ${msg}` : `⚠️ ${msg}`));
      markLastErrored();
      finish();
    }
  }

  // Composer submit: stream the turn now if the agent is free, otherwise queue it to fire when the
  // current reply finishes (the drain effect). Always clears the composer and keeps the caret there,
  // so the next prompt can be typed straight away — including while a reply is still streaming.
  const send = (text: string) => {
    text = text.trim();
    if (!text || usage?.exhausted) return;
    setInput('');
    fieldRef.current?.focus();
    stuckRef.current = true; // submitting re-engages auto-scroll, so the reply is followed
    setShowJump(false);
    if (busy) setQueue((q) => [...q, text]);
    else streamTurn(text);
  };

  // Re-send the message whose reply failed. Drop the failed user+assistant pair, then stream it
  // again on the same conversation. Retry only shows when the agent is free, so it never queues.
  const retryFrom = (assistantIndex: number) => {
    const userMsg = messages[assistantIndex - 1];
    if (!userMsg || userMsg.role !== 'user') return;
    setMessages((m) => m.slice(0, assistantIndex - 1));
    stuckRef.current = true;
    setShowJump(false);
    streamTurn(userMsg.content);
  };

  const idle = messages.length === 0;
  // Nothing to delete on a fresh, empty chat.
  const canDelete = !idle && !loadingHistory;
  // The usage frame arrives *before* the stream's `done`, so a thread can be spent while its
  // last reply is still being written. Hold the composer until that reply lands: only the
  // *next* send is refused, and "start a new chat" must not be reachable mid-stream — deleting
  // there would clear the messages the reveal loop is still writing into.
  const exhausted = usage?.exhausted === true && !busy;

  // Drain the queue: the moment the agent is free, send everything queued as ONE combined follow-up
  // turn (newline-joined), the way Claude Code batches messages typed while it's working — not as
  // separate turns. Guarded on !busy — streamTurn's own setBusy(true) re-runs this effect and the
  // guard stops a double-send. Anything queued *during* that combined turn becomes the next batch.
  useEffect(() => {
    if (busy || exhausted || queue.length === 0) return;
    setQueue([]);
    streamTurn(queue.join('\n'));
  }, [busy, exhausted, queue]);

  // A spent thread refuses everything, so anything still queued would never send — drop it rather
  // than leave it dangling behind the "chat is full" panel.
  useEffect(() => {
    if (exhausted && queue.length) setQueue([]);
  }, [exhausted, queue.length]);

  return (
    <>
      <style>{CSS}</style>

      <button
        className={`sfchat-fab ${open ? 'sfchat-hidden' : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Open the assistant"
      >
        <ChatIcon />
      </button>

      <aside className={`sfchat-panel ${open ? 'sfchat-open' : ''}`} aria-hidden={!open} aria-label="AI assistant">
        <div
          className="sfchat-resize"
          onPointerDown={(e) => {
            e.preventDefault();
            setResizing(true);
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat"
        />

        <header className="sfchat-head">
          <div className="sfchat-id">
            <span className="sfchat-avatar"><AgentIcon /></span>
            <div>
              <strong>Souhaib’s assistant</strong>
              <span className="sfchat-online">
                <i /> online
              </span>
            </div>
          </div>
          <div className="sfchat-actions">
            {canDelete && (
              <div className="sfchat-act-wrap" ref={confirmRef}>
                <button
                  className="sfchat-act"
                  onClick={() => setConfirmingDelete((v) => !v)}
                  disabled={busy}
                  aria-label="Delete conversation"
                  aria-expanded={confirmingDelete}
                >
                  <TrashIcon />
                </button>

                {confirmingDelete && (
                  <div
                    className="sfchat-confirm"
                    role="dialog"
                    aria-label="Confirm deleting the conversation"
                  >
                    <p className="sfchat-confirm-q">
                      {deleteFailed ? 'Couldn’t delete.' : 'Delete chat?'}
                    </p>
                    <p className="sfchat-confirm-sub">
                      {deleteFailed ? 'The conversation is still there.' : 'This can’t be undone.'}
                    </p>
                    <div className="sfchat-confirm-actions">
                      <button
                        className="sfchat-confirm-no"
                        onClick={() => {
                          setConfirmingDelete(false);
                          del.reset();
                        }}
                        disabled={deleting}
                      >
                        Cancel
                      </button>
                      <button
                        className="sfchat-confirm-yes"
                        onClick={() => del.mutate(conversationId.current)}
                        disabled={deleting}
                      >
                        {deleting ? 'Deleting…' : deleteFailed ? 'Retry' : 'Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <button className="sfchat-min" onClick={() => setOpen(false)} aria-label="Minimize">
              <MinIcon />
            </button>
          </div>
        </header>

        <div
          className="sfchat-list"
          ref={listRef}
          onScroll={onListScroll}
          // Reserve room for the floating composer so the last message clears it, not hides behind it.
          style={barH ? { paddingBottom: barH + 8 } : undefined}
        >
          {loadingHistory && <ChatSkeleton />}

          {!loadingHistory && welcomeArmed && (
            <div className="sfchat-row assistant sfchat-enter">
              <span className="sfchat-avatar sm"><AgentIcon /></span>
              <div className={`sfchat-bubble assistant ${welcome ? '' : 'sfchat-typing'}`}>
                {welcome ? (
                  <>
                    <span dangerouslySetInnerHTML={{ __html: renderMarkdown(welcome) }} />
                    {!welcomeDone && <span className="sfchat-caret" />}
                  </>
                ) : (
                  <TypingDots />
                )}
              </div>
            </div>
          )}

          {!loadingHistory && idle && welcomeArmed && welcomeDone && (
            <div className="sfchat-suggest sfchat-enter">
              <span className="sfchat-suglabel">Try asking</span>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="sfchat-chip" onClick={() => send(s)}>
                  <span>{s}</span>
                  <ArrowIcon />
                </button>
              ))}
            </div>
          )}

          {!loadingHistory &&
            messages.map((m, i) => {
              if (m.role === 'user') {
                return (
                  <div key={i} className="sfchat-row user sfchat-enter">
                    <div className="sfchat-bubble user">{m.content}</div>
                  </div>
                );
              }
              const tools = m.tools ?? [];
              const turnActive = i === messages.length - 1 && busy;
              // Typing dots cover only the initial think before any tool appears; once a tool shows,
              // the timeline is the indicator (dots here would flash on and off between steps). They
              // also stand down while a status line is up (the cold-start notice), so the two don't
              // both show at once.
              const showTyping = turnActive && !m.content && tools.length === 0 && !status;
              return (
                <div key={i} className="sfchat-row assistant sfchat-enter">
                  <span className="sfchat-avatar sm"><AgentIcon /></span>
                  <div className="sfchat-assistant-col">
                    {tools.length > 0 && <ToolActivity steps={tools} />}
                    {(showTyping || m.content) && (
                      <div className={`sfchat-bubble assistant ${showTyping ? 'sfchat-typing' : ''}`}>
                        {showTyping ? (
                          <TypingDots />
                        ) : (
                          <span dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                        )}
                      </div>
                    )}
                    {m.model && (
                      <span className="sfchat-model">
                        <Cpu size={11} strokeWidth={2} />
                        {modelLabel(m.model)}
                      </span>
                    )}
                    {m.errored && i === messages.length - 1 && !busy && !exhausted && (
                      <button type="button" className="sfchat-retry" onClick={() => retryFrom(i)}>
                        <RetryIcon />
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

          {status && (
            <div className="sfchat-status sfchat-enter">
              <span className="sfchat-avatar sm"><AgentIcon /></span>
              <span className="sfchat-statustext">
                {status}
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
        </div>

        {showJump && (
          <button
            type="button"
            className="sfchat-jump"
            style={{ bottom: (barH || 64) + 8 }}
            onClick={jumpToLatest}
            aria-label="Scroll to latest"
          >
            <JumpIcon />
          </button>
        )}

        {exhausted ? (
          // Nothing more can be sent to a spent thread, so a composer would only be a dead
          // end. Offer the way forward instead — and say plainly that it clears this one.
          <div className="sfchat-composer-wrap" ref={setBar}>
            <div className="sfchat-spent" role="status">
              <p className="sfchat-spent-title">This chat is full.</p>
              <p className="sfchat-spent-sub">
                Every message carries the whole conversation with it, so a long thread
                eventually reaches its limit. A new chat starts clean — this one is cleared.
              </p>
              <div className="sfchat-spent-foot">
                <ContextGauge usage={usage} />
                <button
                  className="sfchat-spent-go"
                  onClick={() => del.mutate(conversationId.current)}
                  disabled={deleting}
                >
                  {deleting ? 'Starting…' : deleteFailed ? 'Retry' : 'Start a new chat'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form
            className="sfchat-composer-wrap"
            ref={setBar}
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            {queue.length > 0 && (
              <div className="sfchat-queue-wrap">
                <p className="sfchat-queue-cap">Up next · sends automatically</p>
                <ol className="sfchat-queue" aria-label="Queued prompts">
                  {queue.map((q, i) => (
                    <li key={i} className="sfchat-queue-item">
                      <span className="sfchat-queue-text">{q}</span>
                      <button
                        type="button"
                        className="sfchat-queue-remove"
                        onClick={() => setQueue((cur) => cur.filter((_, j) => j !== i))}
                        aria-label={`Remove queued prompt: ${q}`}
                      >
                        <QueueRemoveIcon />
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="sfchat-composer">
              <div className="sfchat-composer-row">
                <textarea
                  ref={fieldRef}
                  className="sfchat-field"
                  value={input}
                  rows={1}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder={busy ? 'Queue another message…' : 'Ask about Souhaib…'}
                  aria-label="Your message"
                  // Stays editable throughout the turn: you can compose (and queue) the next prompt
                  // while a reply is still streaming. `send` decides whether to run or queue it.
                />
                <button className="sfchat-send" type="submit" disabled={!input.trim()} aria-label="Send">
                  <SendIcon />
                </button>
              </div>
              <p className="sfchat-note">
                <span className="sfchat-note-text">
                  <Info size={12} strokeWidth={2} />
                  This assistant is rate-limited to keep it free.
                </span>
                <ContextGauge usage={usage} />
              </p>
            </div>
          </form>
        )}
      </aside>
    </>
  );
}

// The tools the assistant used in one turn, as a timeline: a rotating spinner and a shimmering label
// on the running step, a filled check on each finished one, joined by a rail that fills as it goes.
// It stays fully open — including after the reply finishes — so a completed answer keeps the whole
// record of the tools it ran. Steps live on the message, so they persist for the session (but not
// across a reload — the backend doesn't store them).
function ToolActivity({ steps }: { steps: ToolStep[] }) {
  return (
    <ol className="sfchat-tl" aria-live="polite">
      {steps.map((s, i) => (
        <li key={i} className={`sfchat-tl-step ${s.done ? 'done' : 'active'}`}>
          <span className="sfchat-tl-node">
            {s.done ? <Check size={11} strokeWidth={3} /> : <span className="sfchat-tl-spin" />}
          </span>
          <span className="sfchat-tl-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function ChatIcon() {
  return <MessageSquare size={24} strokeWidth={2} />;
}
function MinIcon() {
  return <ChevronDown size={18} strokeWidth={2} />;
}
function TrashIcon() {
  return <Trash2 size={16} strokeWidth={2} />;
}
function RetryIcon() {
  return <RotateCcw size={13} strokeWidth={2} />;
}
function QueueRemoveIcon() {
  return <X size={14} strokeWidth={2} />;
}
function JumpIcon() {
  return <ArrowDown size={16} strokeWidth={2} />;
}
function SendIcon() {
  return <ArrowUp size={18} strokeWidth={2.25} />;
}
function ArrowIcon() {
  return <ArrowUpRight size={14} strokeWidth={2} />;
}
function AgentIcon() {
  return <Bot size={16} strokeWidth={2} />;
}

const CSS = `
/* Push the page over on desktop instead of covering it. */
@media (min-width: 880px) {
  body { transition: margin-right .44s cubic-bezier(.22,.61,.36,1); }
  body.sfchat-pushed { margin-right: calc(var(--sfchat-w, 460px) + 32px); }
  body.sfchat-resizing { transition: none; }
}
body.sfchat-resizing, body.sfchat-resizing * { user-select: none !important; }

.sfchat-fab {
  position: fixed; right: 22px; bottom: 22px; z-index: 60;
  width: 54px; height: 54px; border-radius: 50%; border: none; cursor: pointer;
  background: var(--accent); color: #fff; box-shadow: var(--shadow-lg);
  display: grid; place-items: center;
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), opacity .25s ease;
}
.sfchat-fab:hover { transform: translateY(-2px); }
.sfchat-fab.sfchat-hidden { transform: scale(.4); opacity: 0; pointer-events: none; }

/* Floating card: detached from the edges, rounded on all sides, elevated. */
.sfchat-panel {
  position: fixed; top: 16px; right: 16px; bottom: 16px; z-index: 61;
  width: var(--sfchat-w, 460px); max-width: calc(100vw - 32px);
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg);                 /* recessed body surface */
  border: 1px solid var(--line); border-radius: 18px; box-shadow: var(--shadow-lg);
  transform: translateX(24px) scale(.98); opacity: 0; transform-origin: bottom right;
  pointer-events: none;
  transition: transform .42s cubic-bezier(.22,.61,.36,1), opacity .3s ease;
}
.sfchat-panel.sfchat-open { transform: none; opacity: 1; pointer-events: auto; }
@media (max-width: 600px) {
  .sfchat-panel { top: 0; right: 0; bottom: 0; left: 0; width: auto; max-width: none; border-radius: 0; border: none; }
}

/* Drag handle on the left edge — a rounded pill that appears on hover. */
.sfchat-resize { position: absolute; left: 0; top: 0; bottom: 0; width: 14px; z-index: 5; cursor: ew-resize; display: grid; place-items: center; }
.sfchat-resize::before {
  content: ''; width: 4px; height: 42px; border-radius: 4px; background: var(--line);
  opacity: 0; transition: opacity .16s ease, background .16s ease, height .16s ease;
}
.sfchat-resize:hover::before { opacity: 1; background: var(--accent); height: 56px; }
@media (max-width: 600px) { .sfchat-resize { display: none; } }

/* Header: an elevated surface raised above the recessed body. */
.sfchat-head {
  position: relative; z-index: 2; flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 15px 18px;
  background: color-mix(in srgb, var(--surface), #fff 9%); box-shadow: var(--shadow-sm);
}
.sfchat-id { display: flex; align-items: center; gap: 11px; min-width: 0; }
.sfchat-id > div { min-width: 0; }
.sfchat-id strong { display: block; font-size: 14.5px; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sfchat-online { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); margin-top: 2px; }
.sfchat-online i { width: 6px; height: 6px; border-radius: 50%; background: #38b26a; animation: sfchat-live 2s ease-out infinite; }
@keyframes sfchat-live { 0% { box-shadow: 0 0 0 0 rgba(56,178,106,.5); } 70%,100% { box-shadow: 0 0 0 5px rgba(56,178,106,0); } }

.sfchat-avatar { width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center; font-size: 14px; background: var(--accent); color: #fff; }
.sfchat-avatar.sm { width: 24px; height: 24px; font-size: 12px; align-self: flex-start; margin-top: 1px; background: color-mix(in srgb, var(--text) 8%, transparent); color: var(--muted); }

.sfchat-min { background: none; border: none; color: var(--muted); cursor: pointer; padding: 6px; border-radius: 8px; display: grid; place-items: center; }
.sfchat-min:hover { color: var(--text); background: color-mix(in srgb, var(--text) 6%, transparent); }

/* Header actions: the destructive one sits left of minimize and stays quiet until hovered. */
.sfchat-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.sfchat-act { background: none; border: none; color: var(--muted); cursor: pointer; padding: 6px; border-radius: 8px; display: grid; place-items: center; transition: color .15s ease, background .15s ease; }
.sfchat-act:hover:not(:disabled) { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
.sfchat-act:disabled { opacity: .35; cursor: not-allowed; }

/* Confirm tooltip: a popover anchored under the trash icon, rather than a native dialog.
   The panel clips overflow, so it opens downward and right-aligned to stay inside. */
.sfchat-act-wrap { position: relative; display: flex; }
.sfchat-confirm {
  position: absolute; top: calc(100% + 9px); right: 0; z-index: 3;
  width: max-content; min-width: 232px; max-width: 280px; text-align: left;
  background: var(--surface); border: 1px solid var(--line); border-radius: 11px;
  box-shadow: var(--shadow-lg); padding: 11px 12px;
  animation: sfchat-confirm-in .16s cubic-bezier(.22,.61,.36,1) both;
}
/* Arrow pointing back up at the icon. */
.sfchat-confirm::before {
  content: ''; position: absolute; top: -5px; right: 12px; width: 8px; height: 8px;
  background: var(--surface); border-left: 1px solid var(--line); border-top: 1px solid var(--line);
  transform: rotate(45deg);
}
@keyframes sfchat-confirm-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.sfchat-confirm-q { margin: 0; font-size: 13px; font-weight: 500; color: var(--text); white-space: nowrap; }
.sfchat-confirm-sub { margin: 3px 0 0; font-size: 11.5px; line-height: 1.4; color: var(--muted); }
.sfchat-confirm-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
.sfchat-confirm-yes, .sfchat-confirm-no {
  font: inherit; font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap;
  border: 1px solid var(--line); border-radius: 7px; padding: 5px 9px;
  background: transparent; color: var(--text);
  transition: border-color .15s ease, background .15s ease, color .15s ease, filter .15s ease;
}
.sfchat-confirm-yes:disabled, .sfchat-confirm-no:disabled { opacity: .55; cursor: default; }
.sfchat-confirm-yes { border-color: transparent; background: var(--danger); color: #fff; }
.sfchat-confirm-yes:hover:not(:disabled) { filter: brightness(1.08); }
/* Dark danger is bright; ink text keeps AA contrast on the solid button (mirrors .btn-solid). */
.dark .sfchat-confirm-yes { color: #2d0a06; }
.sfchat-confirm-no:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }

/* Body: the recessed surface. Bubbles float on it. */
.sfchat-list { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 14px; }

.sfchat-row { display: flex; align-items: flex-start; gap: 8px; }
.sfchat-row.user { justify-content: flex-end; }
.sfchat-enter { animation: sfchat-enter .34s cubic-bezier(.22,.61,.36,1) both; }
@keyframes sfchat-enter { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: none; } }

/* Bubbles: elevated surfaces (shadow) so they pop off the recessed body. */
.sfchat-bubble { max-width: 82%; padding: 11px 14px; border-radius: 15px; font-size: 14px; line-height: 1.55; white-space: pre-wrap; word-wrap: break-word; }
.sfchat-bubble.assistant { background: var(--surface); border: 1px solid var(--line); box-shadow: var(--shadow-sm); border-top-left-radius: 5px; }
.sfchat-bubble.user { background: var(--accent); color: #fff; box-shadow: var(--shadow-sm); border-top-right-radius: 5px; }
.sfchat-bubble a { color: var(--accent); text-decoration: underline; }
.sfchat-bubble.user a { color: #fff; }
.sfchat-bubble code { background: color-mix(in srgb, var(--text) 8%, transparent); padding: 1px 5px; border-radius: 5px; font-size: 12.5px; }
.sfchat-bubble pre { background: color-mix(in srgb, var(--text) 7%, transparent); padding: 10px; border-radius: 9px; overflow-x: auto; margin: 6px 0; }
.sfchat-bubble pre code { background: none; padding: 0; }
.sfchat-li { display: block; padding-left: 14px; position: relative; }
.sfchat-li::before { content: '•'; position: absolute; left: 2px; color: var(--accent); }

/* Assistant column: the tool-activity panel stacked above the reply bubble, sharing the avatar row. */
.sfchat-assistant-col { display: flex; flex-direction: column; align-items: flex-start; gap: 9px; min-width: 0; max-width: 100%; }

/* Tool activity: a flat timeline of the tools the assistant used — no card, sitting directly on the
   panel body, aligned with the message content. A live spinner + shimmer while a step runs, a
   checked node when it's done. Stays on screen after the turn, so a finished reply keeps the full
   record of the tools it ran. (Its own class — not .sfchat-act, which is the header delete button.) */
.sfchat-tl {
  list-style: none; margin: 0; padding: 2px 2px 2px 0; max-width: 100%;
  display: flex; flex-direction: column;
  animation: sfchat-enter .34s cubic-bezier(.22,.61,.36,1) both;
}
.sfchat-tl-step { position: relative; display: flex; align-items: flex-start; gap: 11px; padding-bottom: 14px; animation: sfchat-tlin .34s cubic-bezier(.22,.61,.36,1) both; }
.sfchat-tl-step:last-child { padding-bottom: 0; }
/* Rail linking the nodes; fills accent behind a finished step. */
.sfchat-tl-step:not(:last-child)::before { content: ''; position: absolute; left: 7px; top: 18px; bottom: -1px; width: 2px; border-radius: 2px; background: var(--line); transition: background .3s ease; }
.sfchat-tl-step.done:not(:last-child)::before { background: color-mix(in srgb, var(--accent) 45%, var(--line)); }
@keyframes sfchat-tlin { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.sfchat-tl-node { position: relative; z-index: 1; width: 16px; height: 16px; flex-shrink: 0; display: grid; place-items: center; margin-top: 1px; }
/* Running: a rotating conic-gradient ring (masked to a ring). */
.sfchat-tl-spin {
  width: 15px; height: 15px; border-radius: 50%;
  background: conic-gradient(from 90deg, transparent 8%, color-mix(in srgb, var(--accent) 22%, transparent) 38%, var(--accent) 100%);
  -webkit-mask: radial-gradient(closest-side, transparent 58%, #000 60%);
          mask: radial-gradient(closest-side, transparent 58%, #000 60%);
  animation: sfchat-spin .75s linear infinite;
}
@keyframes sfchat-spin { to { transform: rotate(1turn); } }
/* Done: a filled accent disc with a check, popping in as it replaces the spinner. */
.sfchat-tl-step.done .sfchat-tl-node { background: var(--accent); border-radius: 50%; color: #fff; animation: sfchat-nodepop .3s cubic-bezier(.34,1.56,.64,1) both; }
.dark .sfchat-tl-step.done .sfchat-tl-node { color: #08272a; }
@keyframes sfchat-nodepop { from { transform: scale(.5); } to { transform: scale(1); } }

/* Answering-model caption: a quiet line under the reply naming the model that produced it. */
.sfchat-model { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; color: var(--muted); padding-left: 2px; }
.sfchat-model svg { opacity: .75; }

.sfchat-tl-label { font-size: 13px; line-height: 1.3; color: var(--text); padding-top: 1px; }
.sfchat-tl-step.done .sfchat-tl-label { color: var(--muted); }
/* Active step's label gets a shimmer sweep — the signature "working" cue. */
.sfchat-tl-step.active .sfchat-tl-label {
  background: linear-gradient(100deg, color-mix(in srgb, var(--text) 30%, transparent) 32%, var(--text) 50%, color-mix(in srgb, var(--text) 30%, transparent) 68%);
  background-size: 220% 100%;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;
  animation: sfchat-shimmer 1.5s linear infinite;
}
@keyframes sfchat-shimmer { from { background-position: 220% 0; } to { background-position: -220% 0; } }

/* Retry: a quiet control under a failed turn's bubble, re-sending the message whose reply errored.
   Neutral by default (it's a recovery, not a warning), warming to accent on hover like the chips. */
.sfchat-retry {
  align-self: flex-start;
  display: inline-flex; align-items: center; gap: 6px;
  font: inherit; font-size: 12px; line-height: 1; cursor: pointer;
  border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px;
  background: transparent; color: var(--muted);
  transition: border-color .15s ease, color .15s ease, background .15s ease;
}
.sfchat-retry:hover { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 7%, transparent); }
.sfchat-retry svg { flex-shrink: 0; }

.sfchat-caret { display: inline-block; width: 2px; height: 1em; background: var(--accent); margin-left: 2px; vertical-align: text-bottom; animation: sfchat-blink 1s step-end infinite; }
@keyframes sfchat-blink { 50% { opacity: 0; } }

/* Restore skeleton: neutral placeholder bubbles, pulsing (no gradients). */
.sfchat-skel { display: flex; flex-direction: column; gap: 14px; }
.sfchat-skel-dot { background: color-mix(in srgb, var(--text) 8%, transparent); animation: sfchat-pulse 1.5s ease-in-out infinite; }
.sfchat-skel-bubble { padding: 12px 14px; border-radius: 15px; background: var(--surface); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; }
.sfchat-skel-bubble.assistant { width: min(78%, 300px); border-top-left-radius: 5px; }
.sfchat-skel-bubble.user { width: min(46%, 190px); border-top-right-radius: 5px; }
.sfchat-skel-line { height: 9px; border-radius: 5px; background: color-mix(in srgb, var(--text) 12%, transparent); animation: sfchat-pulse 1.5s ease-in-out infinite; }
.sfchat-skel-line:nth-child(2) { animation-delay: .15s; }
.sfchat-skel-line:nth-child(3) { animation-delay: .3s; }
.sfchat-skel-line:last-child { width: 65%; }
@keyframes sfchat-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }

.sfchat-suggest { display: flex; flex-direction: column; align-items: flex-start; gap: 7px; padding-left: 32px; }
.sfchat-suglabel { font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin-bottom: 3px; padding-left: 2px; }
.sfchat-chip {
  display: inline-flex; align-items: center; gap: 9px; max-width: 100%;
  text-align: left; background: transparent; color: var(--text); cursor: pointer;
  border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; font-size: 13px;
  transition: border-color .16s ease, background .16s ease, color .16s ease;
}
.sfchat-chip svg { color: var(--muted); flex-shrink: 0; transition: transform .16s ease, color .16s ease; }
.sfchat-chip:hover { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 7%, transparent); color: var(--accent); }
.sfchat-chip:hover svg { color: var(--accent); transform: translate(2px, -2px); }

/* Dots-only bubble: a snug, symmetric pill sized and centred to the three dots — not the tall text
   line-box (which left the baseline-aligned dots in a lopsided gap), and without the assistant tail
   corner, whose sharp 5px top-left against the 15px right corners skews a pill this small sideways. */
.sfchat-bubble.sfchat-typing {
  display: inline-flex; align-items: center; justify-content: center;
  line-height: 1; padding: 12px 14px; border-radius: 14px;
}
.sfchat-bubble.sfchat-typing .sfchat-dots { padding: 0; }

.sfchat-dots { display: inline-flex; gap: 4px; align-items: center; padding: 2px 0; }
.sfchat-dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: sfchat-bounce 1.2s ease-in-out infinite; }
.sfchat-dots span:nth-child(2) { animation-delay: .15s; }
.sfchat-dots span:nth-child(3) { animation-delay: .3s; }
@keyframes sfchat-bounce { 0%,60%,100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }

.sfchat-status { display: flex; align-items: flex-start; gap: 8px; }
.sfchat-statustext { display: inline-flex; align-items: center; gap: 3px; font-size: 12.5px; color: var(--muted); font-style: italic; padding-top: 3px; }
.sfchat-statustext i { width: 3px; height: 3px; border-radius: 50%; background: var(--muted); animation: sfchat-bounce 1.2s ease-in-out infinite; }
.sfchat-statustext i:nth-child(3) { animation-delay: .15s; }
.sfchat-statustext i:nth-child(4) { animation-delay: .3s; }

/* Floating composer: a larger elevated box on the body — no footer bar. */
/* Floating composer: overlays the bottom of the message list instead of sitting in its own row, so
   there's no hard divider clipping the last bubble. Messages scroll up behind it and dissolve into a
   scrim — the panel bg, fading to transparent at the very top edge. pointer-events are off on the
   scrim so the messages under it still scroll, and back on for the composer itself (below). The list
   reserves this bar's height (barH) so the newest message rests just above it. */
.sfchat-composer-wrap {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 3;
  padding: 26px 14px 14px; pointer-events: none;
  background: linear-gradient(to top, var(--bg) 78%, transparent);
}
.sfchat-composer, .sfchat-queue-wrap, .sfchat-spent { pointer-events: auto; }

/* "Jump to latest": appears when the user has scrolled up (auto-scroll disengaged), floating centred
   just above the composer. Clicking it re-engages the follow-the-bottom behaviour. */
.sfchat-jump {
  position: absolute; left: 50%; transform: translateX(-50%); z-index: 4;
  width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
  display: grid; place-items: center;
  background: var(--surface); color: var(--muted);
  border: 1px solid var(--line); box-shadow: var(--shadow-md);
  animation: sfchat-enter .2s ease both;
  transition: color .15s ease, border-color .15s ease;
}
.sfchat-jump:hover { color: var(--accent); border-color: var(--accent); }
.sfchat-composer { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 15px; box-shadow: var(--shadow-md); padding: 8px 8px 0; transition: border-color .15s ease, box-shadow .15s ease; }
.sfchat-composer:focus-within { border-color: var(--accent); box-shadow: var(--shadow-lg); }
.sfchat-composer-row { display: flex; align-items: center; gap: 6px; }
.sfchat-field { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: var(--text); font: inherit; font-size: 15px; line-height: 1.5; padding: 16px 12px; resize: none; overflow-y: auto; min-height: 64px; max-height: 150px; }
.sfchat-field::placeholder { color: var(--muted); }
.sfchat-note { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 4px -8px 0; padding: 8px 12px; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); }
.sfchat-note-text { display: flex; align-items: center; gap: 5px; min-width: 0; }
.sfchat-note svg { flex-shrink: 0; opacity: .8; }

/* Context gauge: a hairline bar that stays quiet until the thread is nearly spent. No
   gradient, no glow, no ambient animation — it earns attention only by warming. */
.sfchat-gauge-wrap { position: relative; display: inline-flex; flex-shrink: 0; }
.sfchat-gauge { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; font-variant-numeric: tabular-nums; cursor: default; border-radius: 4px; }

/* Tooltip: the bar can't say what it measures, so hovering (or focusing) explains it and
   prints the exact figures the label rounds off. Opens upward — the gauge sits at the
   bottom of a panel that clips its overflow. Mirrors the confirm popover's surface. */
.sfchat-gauge-tip {
  position: absolute; bottom: calc(100% + 9px); right: 0; z-index: 4;
  width: max-content; white-space: nowrap;
  font-size: 11px; color: var(--text); font-variant-numeric: tabular-nums;
  background: var(--surface); border: 1px solid var(--line); border-radius: 11px;
  box-shadow: var(--shadow-lg); padding: 10px 11px;
  opacity: 0; visibility: hidden; transform: translateY(3px); pointer-events: none;
  transition: opacity .16s ease, transform .16s ease, visibility .16s;
}
.sfchat-gauge-wrap:hover .sfchat-gauge-tip,
.sfchat-gauge:focus-visible ~ .sfchat-gauge-tip { opacity: 1; visibility: visible; transform: none; }
/* Arrow pointing back down at the bar. */
.sfchat-gauge-tip::after {
  content: ''; position: absolute; bottom: -5px; right: 14px; width: 8px; height: 8px;
  background: var(--surface); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);
  transform: rotate(45deg);
}
.sfchat-gauge-track { width: 38px; height: 3px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, var(--text) 12%, transparent); }
.sfchat-gauge-fill { display: block; height: 100%; border-radius: inherit; background: var(--muted); transition: width .4s ease, background-color .4s ease; }
.sfchat-gauge-num { color: var(--muted); white-space: nowrap; }
.sfchat-gauge.warm .sfchat-gauge-fill { background: var(--warn); }
.sfchat-gauge.warm .sfchat-gauge-num { color: var(--warn); }

/* Spent thread: replaces the composer. An invitation, not an error — no danger colour. */
.sfchat-spent { background: var(--surface); border: 1px solid var(--line); border-radius: 15px; box-shadow: var(--shadow-md); padding: 14px; }
.sfchat-spent-title { margin: 0; font-size: 13.5px; font-weight: 500; color: var(--text); }
.sfchat-spent-sub { margin: 4px 0 0; font-size: 11.5px; line-height: 1.45; color: var(--muted); }
.sfchat-spent-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; font-size: 11px; }
.sfchat-spent-go {
  font: inherit; font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap; flex-shrink: 0;
  border: 1px solid transparent; border-radius: 8px; padding: 7px 11px;
  background: var(--accent); color: #fff;
  transition: filter .15s ease;
}
.sfchat-spent-go:hover:not(:disabled) { filter: brightness(1.08); }
.sfchat-spent-go:disabled { opacity: .55; cursor: default; }
/* Dark accent is bright; ink text keeps AA contrast on the solid button (mirrors .btn-solid). */
.dark .sfchat-spent-go { color: #08272a; }
.sfchat-send { width: 42px; height: 42px; flex-shrink: 0; border: none; border-radius: 11px; background: var(--accent); color: #fff; cursor: pointer; display: grid; place-items: center; transition: opacity .15s ease, transform .12s ease; }
.sfchat-send:hover:not(:disabled) { transform: scale(1.05); }
.sfchat-send:disabled { opacity: .4; cursor: not-allowed; }

/* Prompt queue: prompts typed while a reply is still streaming. They sit above the composer and
   fire automatically, in order, as each reply completes. Accent-tinted so they read as pending
   (not sent, not an error), each with a remove control. */
.sfchat-queue-wrap { margin-bottom: 10px; }
.sfchat-queue-cap { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); padding-left: 2px; }
.sfchat-queue { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.sfchat-queue-item {
  display: flex; align-items: center; gap: 8px;
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--line));
  border-radius: 10px; padding: 7px 7px 7px 11px;
  animation: sfchat-tlin .28s cubic-bezier(.22,.61,.36,1) both;
}
.sfchat-queue-text { flex: 1; min-width: 0; font-size: 13px; line-height: 1.35; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sfchat-queue-remove {
  flex-shrink: 0; display: grid; place-items: center; width: 22px; height: 22px;
  border: none; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer;
  transition: color .15s ease, background .15s ease;
}
.sfchat-queue-remove:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }

@media (prefers-reduced-motion: reduce) {
  body, .sfchat-panel, .sfchat-fab, .sfchat-enter, .sfchat-chip, .sfchat-confirm, .sfchat-gauge-fill, .sfchat-gauge-tip,
  .sfchat-tl, .sfchat-tl-step, .sfchat-tl-step::before, .sfchat-queue-item, .sfchat-jump,
  .sfchat-tl-spin, .sfchat-tl-step.done .sfchat-tl-node { transition: none; animation: none; }
  /* The shimmer paints the label with transparent text; without the animation that would leave it
     invisible, so restore a solid colour when motion is reduced. */
  .sfchat-tl-step.active .sfchat-tl-label { background: none; -webkit-text-fill-color: currentColor; color: var(--text); }
}
`;
