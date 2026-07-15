import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatWidget from './ChatWidget';

// The widget renders nothing unless the browser is in internal/owner mode.
vi.mock('../../lib/internal', () => ({ isInternal: () => true }));

const API = 'https://api.test'; // pinned in vitest.config.ts
const CID = 'c0ffee00-dead-beef-cafe-000000000001';
const CONV_URL = `${API}/chat/conversations/${CID}/`;

const RESTORED = [
  { role: 'user', content: 'What is his experience with AI?' },
  { role: 'assistant', content: 'He owns AI features end to end.' },
];

const USAGE = { context_tokens: 4200, context_limit: 20000, exhausted: false };
const SPENT = { context_tokens: 20000, context_limit: 20000, exhausted: true };

/** When set, the stub stream holds open before `done` until this resolves — so a test can
 *  observe the widget mid-stream, after the last frame but before the turn ends. */
let streamGate: Promise<void> | null = null;
let releaseStream: () => void = () => {};

/** A stubbed SSE body: one `data:` frame per read, then done. */
function sseBody(frames: unknown[]) {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    getReader: () => ({
      read: async () => {
        if (i >= frames.length) {
          if (streamGate) await streamGate;
          return { value: undefined, done: true };
        }
        return { value: encoder.encode(`data: ${JSON.stringify(frames[i++])}\n\n`), done: false };
      },
    }),
  };
}

// Every loading state is floored at 1s (useMinLoadingDuration), so anything waiting on a
// settled load needs longer than waitFor's 1s default.
const SETTLED = { timeout: 3000 };

type Call = { url: string; method: string };
let calls: Call[] = [];
/** Status the stubbed backend answers DELETE with. */
let deleteStatus = 204;
/** Usage the stubbed restore endpoint reports. */
let restoreUsage: unknown = USAGE;
/** Status the stubbed /chat/stream answers with, and the frames it streams on a 200. */
let streamStatus = 200;
let streamFrames: unknown[] = [];
/** Body the stubbed /chat/stream answers a 403 with. */
let forbiddenBody: unknown = null;

const deleteCalls = () => calls.filter((c) => c.method === 'DELETE');

beforeEach(() => {
  calls = [];
  deleteStatus = 204;
  restoreUsage = USAGE;
  streamStatus = 200;
  streamFrames = [{ conversation_id: CID }, { text: 'Sure.' }, { done: true }];
  forbiddenBody = null;
  streamGate = null;
  releaseStream = () => {};
  localStorage.clear();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method });
      // A real request always takes at least a tick. Resolving in a microtask lets React
      // batch the pending state away entirely, so the loading flag is never rendered — and
      // a floor over a state that never rendered is meaningless (nothing flashed either).
      await new Promise((r) => setTimeout(r, 20));
      if (String(url).endsWith('/chat/stream')) {
        // A refused thread answers with JSON and no body to read — not a stream.
        if (streamStatus === 403) return { ok: false, status: 403, json: async () => forbiddenBody };
        return { ok: true, status: 200, body: sseBody(streamFrames) };
      }
      if (method === 'DELETE') {
        return { ok: deleteStatus >= 200 && deleteStatus < 300, status: deleteStatus };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: CID, messages: RESTORED, usage: restoreUsage }),
      };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Render with a stored conversation and wait for it to restore (past the 1s skeleton hold). */
async function renderRestored() {
  localStorage.setItem('chat_conversation_id', CID);
  render(<ChatWidget />);
  return screen.findByRole('button', { name: 'Delete conversation' }, { timeout: 3000 });
}

/** Type a message and send it. */
function sendMessage(text: string) {
  fireEvent.change(screen.getByLabelText('Your message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

describe('ChatWidget — deleting a conversation', () => {
  it('offers no delete control on a fresh, empty chat', async () => {
    render(<ChatWidget />);
    // Wait for the panel to open — until then it's aria-hidden and role queries see nothing,
    // which would make the assertion below pass for the wrong reason.
    await screen.findByRole('button', { name: 'Minimize' });

    expect(screen.queryByRole('button', { name: 'Delete conversation' })).toBeNull();
  });

  it('shows the delete control once a restored conversation has messages', async () => {
    const trash = await renderRestored();

    expect(trash).not.toBeNull();
    expect(screen.getByText('He owns AI features end to end.')).not.toBeNull();
  });

  it('asks for confirmation instead of deleting on the first click', async () => {
    const trash = await renderRestored();
    fireEvent.click(trash);

    expect(screen.getByText('Delete chat?')).not.toBeNull();
    expect(deleteCalls()).toHaveLength(0);
    // The conversation is untouched while the confirm is pending.
    expect(localStorage.getItem('chat_conversation_id')).toBe(CID);
    expect(screen.getByText('He owns AI features end to end.')).not.toBeNull();
  });

  it('cancelling dismisses the confirm and leaves the conversation alone', async () => {
    const trash = await renderRestored();
    fireEvent.click(trash);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Delete chat?')).toBeNull();
    expect(deleteCalls()).toHaveLength(0);
    expect(localStorage.getItem('chat_conversation_id')).toBe(CID);
    expect(screen.getByRole('button', { name: 'Delete conversation' })).not.toBeNull();
  });

  it('Escape dismisses the confirm without deleting', async () => {
    const trash = await renderRestored();
    fireEvent.click(trash);
    expect(screen.getByText('Delete chat?')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByText('Delete chat?')).toBeNull();
    expect(deleteCalls()).toHaveLength(0);
    expect(localStorage.getItem('chat_conversation_id')).toBe(CID);
  });

  it('clicking outside dismisses the confirm without deleting', async () => {
    const trash = await renderRestored();
    fireEvent.click(trash);
    expect(screen.getByText('Delete chat?')).not.toBeNull();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByText('Delete chat?')).toBeNull();
    expect(deleteCalls()).toHaveLength(0);
    expect(localStorage.getItem('chat_conversation_id')).toBe(CID);
  });

  it('DELETEs the conversation, then resets to a fresh chat', async () => {
    const trash = await renderRestored();
    fireEvent.click(trash);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // Hits the same URL the restore uses, with the DELETE method.
    await waitFor(() => expect(deleteCalls()).toHaveLength(1), SETTLED);
    expect(deleteCalls()[0].url).toBe(CONV_URL);

    // The spec tells the client to drop its stored id; the messages go with it.
    await waitFor(() => expect(localStorage.getItem('chat_conversation_id')).toBeNull(), SETTLED);
    expect(screen.queryByText('He owns AI features end to end.')).toBeNull();

    // Back to a first-visit chat: the greeting is re-armed (typing indicator, then it types out)
    // and there's nothing left to delete.
    expect(screen.getByLabelText('typing')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).toBeNull();
  });

  it('keeps "Deleting…" on screen even though the backend answers instantly', async () => {
    const trash = await renderRestored();
    fireEvent.click(trash);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // The stub resolves in microseconds, so without the loading floor this state would be
    // gone before it could be read.
    await waitFor(() => expect(deleteCalls()).toHaveLength(1), SETTLED);
    expect(screen.getByRole('button', { name: 'Deleting…' })).not.toBeNull();
    // The request is already done, yet nothing has been torn down yet.
    expect(localStorage.getItem('chat_conversation_id')).toBe(CID);

    // ...and it does resolve, once the floor elapses.
    await waitFor(() => expect(localStorage.getItem('chat_conversation_id')).toBeNull(), SETTLED);
  });

  it('treats a 404 as already deleted and still resets', async () => {
    deleteStatus = 404; // the thread was gone server-side (e.g. the free DB was reset)
    const trash = await renderRestored();
    fireEvent.click(trash);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(localStorage.getItem('chat_conversation_id')).toBeNull(), SETTLED);
    expect(screen.queryByText('He owns AI features end to end.')).toBeNull();
  });

  it('keeps the conversation and offers a retry when the delete fails', async () => {
    deleteStatus = 500;
    const trash = await renderRestored();
    fireEvent.click(trash);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // The privacy page promises the data is really gone, so a failed delete must not clear
    // the UI and imply success — the thread stays until the backend confirms.
    await waitFor(() => expect(screen.getByText('Couldn’t delete.')).not.toBeNull(), SETTLED);
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull();
    expect(localStorage.getItem('chat_conversation_id')).toBe(CID);
    expect(screen.getByText('He owns AI features end to end.')).not.toBeNull();
  });

  it('retrying after a failure deletes and resets', async () => {
    deleteStatus = 500;
    const trash = await renderRestored();
    fireEvent.click(trash);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('button', { name: 'Retry' }, SETTLED);

    deleteStatus = 204; // backend recovers
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(localStorage.getItem('chat_conversation_id')).toBeNull(), SETTLED);
    expect(deleteCalls()).toHaveLength(2);
    expect(screen.queryByText('He owns AI features end to end.')).toBeNull();
  });
});

describe('ChatWidget — context gauge', () => {
  it('shows an empty gauge on a fresh chat, where nothing is known yet', async () => {
    render(<ChatWidget />);
    await screen.findByRole('button', { name: 'Minimize' });

    // The bar is on screen from the start, but prints no figures: the limit is the backend's
    // to report, so "0 / 20k" here would be an invention.
    const gauge = screen.getByRole('progressbar');
    expect(gauge.getAttribute('aria-valuenow')).toBeNull();
    expect(screen.getByText('—')).not.toBeNull();
    expect(screen.getByText('Context window: —')).not.toBeNull();
  });

  it('rebuilds the gauge from a restored conversation', async () => {
    await renderRestored();

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('21'); // 4.2k/20k
    expect(screen.getByText('4.2k / 20k')).not.toBeNull();
  });

  it('explains itself, and prints the exact figures the label rounds off', async () => {
    await renderRestored();

    // The tooltip is hidden until hover, so it's out of the accessibility tree — reach it
    // through the link the gauge advertises, which is the thing worth pinning anyway.
    const gauge = screen.getByRole('progressbar');
    const tip = document.getElementById(gauge.getAttribute('aria-describedby') ?? '');
    expect(tip?.getAttribute('role')).toBe('tooltip');
    // "4.2k / 20k" rounds; the tooltip carries the real numbers.
    expect(tip?.textContent).toBe('Context window: 4,200 / 20,000');
  });

  it('updates the gauge from the usage frame', async () => {
    streamFrames = [
      { conversation_id: CID },
      { text: 'Sure.' },
      { usage: { context_tokens: 8400, context_limit: 20000, exhausted: false } },
      { done: true },
    ];
    render(<ChatWidget />);
    // Wait on a role query: until the panel opens it's aria-hidden, and role queries — which
    // sendMessage uses — can't see inside it.
    await screen.findByRole('button', { name: 'Minimize' });
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('8.4k / 20k')).not.toBeNull(), SETTLED);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
  });

  it('keeps the last known figures when a turn reports no usage', async () => {
    await renderRestored();
    expect(screen.getByText('4.2k / 20k')).not.toBeNull();

    streamFrames = [{ conversation_id: CID }, { text: 'Sure.' }, { done: true }]; // no usage frame
    sendMessage('hi');
    await waitFor(() => expect(screen.getByText('Sure.')).not.toBeNull(), SETTLED);

    // Never reset to zero on a missing frame — that would claim the context emptied.
    expect(screen.getByText('4.2k / 20k')).not.toBeNull();
  });

  it('replaces the composer with an invitation once the thread is spent', async () => {
    restoreUsage = SPENT;
    await renderRestored();

    expect(screen.getByText('This chat is full.')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Start a new chat' })).not.toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    // Nothing more can be sent to it, so there's nothing left to type into.
    expect(screen.queryByLabelText('Your message')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('lets the reply that spends the thread finish before closing the composer', async () => {
    // `usage` arrives before `done`, so the thread is already spent while its last reply is
    // still streaming. Hold the stream open after that frame to sit in exactly that window.
    streamFrames = [{ conversation_id: CID }, { text: 'One last answer.' }, { usage: SPENT }];
    streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    await renderRestored();
    sendMessage('last one');

    // The gauge proves the spent figures have landed...
    await waitFor(
      () => expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100'),
      SETTLED,
    );
    // ...yet the turn is still running, so the composer must stay: swapping here would cut the
    // reply's own composer away mid-sentence and — worse — offer to delete the conversation
    // that the reveal loop is still writing into.
    expect(screen.queryByText('This chat is full.')).toBeNull();
    expect(screen.getByLabelText('Your message')).not.toBeNull();

    releaseStream();

    // Only once the reply has landed does the composer close — and the answer survives intact.
    await waitFor(() => expect(screen.getByText('This chat is full.')).not.toBeNull(), SETTLED);
    expect(screen.getByText('One last answer.')).not.toBeNull();
  });

  it('a refused (403) send disables the composer without erroring', async () => {
    await renderRestored();
    streamStatus = 403;
    forbiddenBody = { error: 'this conversation has reached its context limit', usage: SPENT };

    sendMessage('one more');
    await waitFor(() => expect(screen.getByText('This chat is full.')).not.toBeNull(), SETTLED);

    // Refused before any model call, so the stored thread has no record of the turn — it must
    // not be left on screen for a reload to silently erase. It's also not an error.
    expect(screen.queryByText('one more')).toBeNull();
    expect(screen.queryByText(/⚠️/)).toBeNull();
    // ...and the real history is untouched.
    expect(screen.getByText('He owns AI features end to end.')).not.toBeNull();
  });

  it('starting a new chat from the spent state clears the thread and restores the composer', async () => {
    restoreUsage = SPENT;
    await renderRestored();

    fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' }));

    // The spent thread is really deleted, not just abandoned — no orphan left server-side.
    await waitFor(() => expect(localStorage.getItem('chat_conversation_id')).toBeNull(), SETTLED);
    expect(deleteCalls()).toHaveLength(1);
    expect(screen.queryByText('He owns AI features end to end.')).toBeNull();
    // Back to a usable chat, with the gauge emptied back to unknown rather than zero.
    expect(screen.getByLabelText('Your message')).not.toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull();
  });
});
