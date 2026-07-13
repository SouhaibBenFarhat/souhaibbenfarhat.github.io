import { useEffect, useRef, useState } from 'react';

const API = import.meta.env.PUBLIC_CHAT_API ?? 'https://portfolio-backend-2huw.onrender.com';

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

type Message = { role: 'user' | 'assistant'; content: string };

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

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState('');
  const conversationId = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const welcomeDone = welcome.length >= WELCOME.length;

  // Auto-open on every load — start closed, then open so the slide-in animates.
  useEffect(() => {
    conversationId.current = localStorage.getItem('chat_conversation_id');
    const t = window.setTimeout(() => setOpen(true), 140);
    return () => window.clearTimeout(t);
  }, []);

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

  // Type out the welcome message once, shortly after the panel starts opening.
  useEffect(() => {
    let i = 0;
    let interval: number | undefined;
    const start = window.setTimeout(() => {
      interval = window.setInterval(() => {
        i += 2;
        setWelcome(WELCOME.slice(0, i));
        if (i >= WELCOME.length) window.clearInterval(interval);
      }, 16);
    }, 480);
    return () => {
      window.clearTimeout(start);
      if (interval) window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status, welcome, open]);

  async function send(text: string) {
    text = text.trim();
    if (!text || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setBusy(true);
    setStatus('thinking');

    const setLastAssistant = (updater: (prev: string) => string) =>
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', content: updater(copy[copy.length - 1].content) };
        return copy;
      });

    try {
      const res = await fetch(`${API}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversation_id: conversationId.current }),
      });
      if (res.status === 429) throw new Error('You’re sending messages too fast — give it a moment.');
      if (!res.ok || !res.body) throw new Error('Sorry, I’m having trouble right now.');

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
          if (data.text) {
            setStatus(null);
            setLastAssistant((prev) => prev + data.text);
          }
          if (data.error) setLastAssistant(() => '⚠️ Sorry — I couldn’t answer that. Please try again.');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setLastAssistant(() => '⚠️ ' + msg);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  const idle = messages.length === 0;

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
            <span className="sfchat-avatar">✦</span>
            <div>
              <strong>Souhaib’s assistant</strong>
              <span className="sfchat-online">
                <i /> online
              </span>
            </div>
          </div>
          <button className="sfchat-min" onClick={() => setOpen(false)} aria-label="Minimize">
            <MinIcon />
          </button>
        </header>

        <div className="sfchat-list" ref={listRef}>
          <div className="sfchat-row assistant sfchat-enter">
            <span className="sfchat-avatar sm">✦</span>
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

          {idle && welcomeDone && (
            <div className="sfchat-chips sfchat-enter">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="sfchat-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`sfchat-row ${m.role} sfchat-enter`}>
              {m.role === 'assistant' && <span className="sfchat-avatar sm">✦</span>}
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
              <span className="sfchat-avatar sm">✦</span>
              <span className="sfchat-statustext">
                {status}
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
        </div>

        <form
          className="sfchat-composer-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <div className="sfchat-composer">
            <input
              className="sfchat-field"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about Souhaib…"
              aria-label="Your message"
              disabled={busy}
            />
            <button className="sfchat-send" type="submit" disabled={busy || !input.trim()} aria-label="Send">
              <SendIcon />
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function MinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
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
  background: var(--surface); box-shadow: var(--shadow-sm);
}
.sfchat-id { display: flex; align-items: center; gap: 11px; }
.sfchat-id strong { display: block; font-size: 14.5px; letter-spacing: -.01em; }
.sfchat-online { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); margin-top: 2px; }
.sfchat-online i { width: 6px; height: 6px; border-radius: 50%; background: #38b26a; animation: sfchat-live 2s ease-out infinite; }
@keyframes sfchat-live { 0% { box-shadow: 0 0 0 0 rgba(56,178,106,.5); } 70%,100% { box-shadow: 0 0 0 5px rgba(56,178,106,0); } }

.sfchat-avatar { width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0; display: grid; place-items: center; font-size: 14px; background: var(--accent); color: #fff; }
.sfchat-avatar.sm { width: 24px; height: 24px; font-size: 12px; align-self: flex-start; margin-top: 1px; }

.sfchat-min { background: none; border: none; color: var(--muted); cursor: pointer; padding: 6px; border-radius: 8px; display: grid; place-items: center; }
.sfchat-min:hover { color: var(--text); background: color-mix(in srgb, var(--text) 6%, transparent); }

/* Body: the recessed surface. Bubbles float on it. */
.sfchat-list { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 14px; }

.sfchat-row { display: flex; align-items: flex-start; gap: 8px; }
.sfchat-row.user { justify-content: flex-end; }
.sfchat-enter { animation: sfchat-enter .34s cubic-bezier(.22,.61,.36,1) both; }
@keyframes sfchat-enter { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: none; } }

/* Bubbles: elevated surfaces (shadow) so they pop off the recessed body. */
.sfchat-bubble { max-width: 82%; padding: 11px 14px; border-radius: 15px; font-size: 14px; line-height: 1.55; white-space: pre-wrap; word-wrap: break-word; }
.sfchat-bubble.assistant { background: var(--surface); box-shadow: var(--shadow-sm); border-top-left-radius: 5px; }
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

.sfchat-chips { display: flex; flex-direction: column; gap: 8px; padding-left: 32px; }
.sfchat-chip { text-align: left; background: var(--surface); color: var(--text); cursor: pointer; border: 1px solid var(--line); border-radius: 12px; padding: 10px 13px; font-size: 13px; box-shadow: var(--shadow-sm); transition: border-color .18s ease, transform .12s ease; }
.sfchat-chip:hover { border-color: var(--accent); transform: translateX(2px); }

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
.sfchat-composer { display: flex; align-items: center; gap: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: 15px; box-shadow: var(--shadow-md); padding: 6px; transition: border-color .15s ease, box-shadow .15s ease; }
.sfchat-composer:focus-within { border-color: var(--accent); box-shadow: var(--shadow-lg); }
.sfchat-field { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: var(--text); font: inherit; font-size: 15px; padding: 11px 12px; }
.sfchat-field::placeholder { color: var(--muted); }
.sfchat-send { width: 42px; height: 42px; flex-shrink: 0; border: none; border-radius: 11px; background: var(--accent); color: #fff; cursor: pointer; display: grid; place-items: center; transition: opacity .15s ease, transform .12s ease; }
.sfchat-send:hover:not(:disabled) { transform: scale(1.05); }
.sfchat-send:disabled { opacity: .4; cursor: not-allowed; }

@media (prefers-reduced-motion: reduce) {
  body, .sfchat-panel, .sfchat-fab, .sfchat-enter, .sfchat-chip { transition: none; animation: none; }
}
`;
