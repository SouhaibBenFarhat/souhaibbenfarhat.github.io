import { useEffect, useId, useRef, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ArrowUp, ArrowUpRight, Bot, ChevronDown, Info, MessageSquare, Trash2 } from 'lucide-react';

import { API } from '../../lib/api';
import { isInternal } from '../../lib/internal';
import { createQueryClient } from '../../lib/queries/client';
import { useConversation, type ChatUsage, type Message } from '../../lib/queries/useConversation';
import { useDeleteConversation } from '../../lib/queries/useDeleteConversation';

const TOOL_LABELS: Record<string, string> = {
  get_facts: 'loading facts',
  get_cv: 'reading the CV',
  list_github_projects: 'exploring projects',
  get_repo_readme: 'reading the project',
};

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
  const [messages, setMessages] = useState<Message[]>([]);
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
  const conversationId = useRef<string | null>(storedId);
  const seeded = useRef(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const revealRaf = useRef<number | null>(null);
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
  };

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
    // While streaming, the text grows a few chars per frame — an instant scroll pins
    // to the bottom and reads as one continuous glide. Smooth-scrolling here would
    // restart its animation every frame and stutter. Use smooth only for one-off jumps.
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: busy ? 'auto' : 'smooth',
    });
  }, [messages, status, welcome, open, busy]);

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

  async function send(text: string) {
    text = text.trim();
    if (!text || busy || usage?.exhausted) return;
    setInput('');
    // Sending from the send button or a suggestion chip leaves focus on a control that is about
    // to disable itself (or unmount), which would drop the caret on <body>. Put it back in the
    // composer so the next question can just be typed. A no-op when Enter sent the message.
    fieldRef.current?.focus();
    setConfirmingDelete(false);
    setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setBusy(true);
    setStatus('thinking');

    const setLastAssistant = (updater: (prev: string) => string) =>
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', content: updater(copy[copy.length - 1].content) };
        return copy;
      });

    // --- Smooth reveal: buffer incoming tokens and paint them at a steady pace ---
    let pending = ''; // tokens received but not yet shown on screen
    let netDone = false; // the network stream has finished
    let carry = 0; // fractional-character accumulator across frames
    let lastTick = 0;

    const finish = () => {
      revealRaf.current = null;
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
      setStatus('thinking');

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
          if (data.tool && data.status === 'start') setStatus(TOOL_LABELS[data.tool] ?? 'working');
          if (data.tool && data.status === 'end') setStatus('writing');
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
          if (data.error) {
            pending = '';
            setLastAssistant(() => '⚠️ Sorry — I couldn’t answer that. Please try again.');
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
      setLastAssistant(() => '⚠️ ' + msg);
      finish();
    }
  }

  const idle = messages.length === 0;
  // Nothing to delete on a fresh, empty chat.
  const canDelete = !idle && !loadingHistory;
  // The usage frame arrives *before* the stream's `done`, so a thread can be spent while its
  // last reply is still being written. Hold the composer until that reply lands: only the
  // *next* send is refused, and "start a new chat" must not be reachable mid-stream — deleting
  // there would clear the messages the reveal loop is still writing into.
  const exhausted = usage?.exhausted === true && !busy;

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

        <div className="sfchat-list" ref={listRef}>
          {loadingHistory && <ChatSkeleton />}

          {!loadingHistory && welcomeArmed && (
            <div className="sfchat-row assistant sfchat-enter">
              <span className="sfchat-avatar sm"><AgentIcon /></span>
              <div className="sfchat-bubble assistant">
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
            messages.map((m, i) => (
            <div key={i} className={`sfchat-row ${m.role} sfchat-enter`}>
              {m.role === 'assistant' && <span className="sfchat-avatar sm"><AgentIcon /></span>}
              <div className={`sfchat-bubble ${m.role}`}>
                {m.role === 'assistant' && i === messages.length - 1 && busy && !m.content ? (
                  <TypingDots />
                ) : m.role === 'assistant' ? (
                  <span dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                ) : (
                  m.content
                )}
              </div>
            </div>
          ))}

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

        {exhausted ? (
          // Nothing more can be sent to a spent thread, so a composer would only be a dead
          // end. Offer the way forward instead — and say plainly that it clears this one.
          <div className="sfchat-composer-wrap">
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
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
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
                  placeholder="Ask about Souhaib…"
                  aria-label="Your message"
                  // Not `disabled`: a disabled control can't hold focus, so the browser blurs it
                  // and the caret lands on <body> for the whole turn. readOnly refuses edits just
                  // the same, but keeps the caret. `send` already guards re-entrancy on `busy`.
                  readOnly={busy}
                />
                <button className="sfchat-send" type="submit" disabled={busy || !input.trim()} aria-label="Send">
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

function ChatIcon() {
  return <MessageSquare size={24} strokeWidth={2} />;
}
function MinIcon() {
  return <ChevronDown size={18} strokeWidth={2} />;
}
function TrashIcon() {
  return <Trash2 size={16} strokeWidth={2} />;
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
.sfchat-composer-wrap { padding: 14px; flex-shrink: 0; }
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

@media (prefers-reduced-motion: reduce) {
  body, .sfchat-panel, .sfchat-fab, .sfchat-enter, .sfchat-chip, .sfchat-confirm, .sfchat-gauge-fill, .sfchat-gauge-tip { transition: none; animation: none; }
}
`;
