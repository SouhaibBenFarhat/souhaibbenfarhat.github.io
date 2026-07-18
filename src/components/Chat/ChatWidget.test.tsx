import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatWidget, { completeMarkdown } from './ChatWidget';

// Owner/internal mode. The chat is public, so this no longer gates rendering — it only decides
// whether raw error `detail` is shown (owner) or hidden (public). Controllable per test; most tests
// run as the owner so the existing detail assertions hold. Reset to owner in beforeEach.
const { mockInternal } = vi.hoisted(() => ({ mockInternal: { value: true } }));
vi.mock('../../lib/internal', () => ({ isInternal: () => mockInternal.value }));

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

type Call = { url: string; method: string; body?: string };
let calls: Call[] = [];
/** Status the stubbed backend answers DELETE with. */
let deleteStatus = 204;
/** Usage the stubbed restore endpoint reports. */
let restoreUsage: unknown = USAGE;
/** Messages the stubbed restore endpoint returns. */
let restoreMessages: unknown = RESTORED;
/** Status the stubbed /chat/stream answers with, and the frames it streams on a 200. */
let streamStatus = 200;
let streamFrames: unknown[] = [];
/** Body the stubbed /chat/stream answers a 403 with. */
let forbiddenBody: unknown = null;
/** Status the stubbed rating endpoint answers with. */
let ratingStatus = 200;

const deleteCalls = () => calls.filter((c) => c.method === 'DELETE');
const streamCalls = () => calls.filter((c) => c.url.endsWith('/chat/stream'));
const rateCalls = () => calls.filter((c) => c.url.includes('/rating/'));

beforeEach(() => {
  mockInternal.value = true; // owner by default; the public-visitor tests flip this
  calls = [];
  deleteStatus = 204;
  restoreUsage = USAGE;
  restoreMessages = RESTORED;
  streamStatus = 200;
  streamFrames = [{ conversation_id: CID }, { text: 'Sure.' }, { done: true }];
  forbiddenBody = null;
  ratingStatus = 200;
  streamGate = null;
  releaseStream = () => {};
  localStorage.clear();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method, body: init?.body ? String(init.body) : undefined });
      // A real request always takes at least a tick. Resolving in a microtask lets React
      // batch the pending state away entirely, so the loading flag is never rendered — and
      // a floor over a state that never rendered is meaningless (nothing flashed either).
      await new Promise((r) => setTimeout(r, 20));
      if (String(url).endsWith('/chat/stream')) {
        // A refused thread answers with JSON and no body to read — not a stream.
        if (streamStatus === 403) return { ok: false, status: 403, json: async () => forbiddenBody };
        return { ok: true, status: 200, body: sseBody(streamFrames) };
      }
      // Rate a message: echoes back the value it was sent, like the real endpoint.
      if (String(url).includes('/rating/')) {
        const sent = init?.body ? JSON.parse(String(init.body)) : {};
        return {
          ok: ratingStatus >= 200 && ratingStatus < 300,
          status: ratingStatus,
          json: async () => ({ id: 1, rating: sent.rating === 0 ? null : sent.rating }),
        };
      }
      if (method === 'DELETE') {
        return { ok: deleteStatus >= 200 && deleteStatus < 300, status: deleteStatus };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: CID, messages: restoreMessages, usage: restoreUsage }),
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

// jsdom does not blur an element when it becomes disabled, the way a browser does — so
// `document.activeElement` alone cannot catch the bug these cover. The load-bearing assertion
// is that the composer is never `disabled` mid-turn, which is what costs it the caret for real.
describe('ChatWidget — composer focus', () => {
  /** Open a fresh chat and put the caret in the composer, as clicking into it would. */
  async function focusedComposer() {
    render(<ChatWidget />);
    await screen.findByRole('button', { name: 'Minimize' });
    const field = screen.getByLabelText('Your message') as HTMLTextAreaElement;
    field.focus();
    expect(document.activeElement).toBe(field);
    return field;
  }

  /** Hold the stream open after its last frame, to observe the composer mid-turn. */
  function holdStream() {
    streamFrames = [{ conversation_id: CID }, { text: 'Sure.' }];
    streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
  }

  it('keeps the caret in the composer while the reply streams', async () => {
    holdStream();
    const field = await focusedComposer();

    fireEvent.change(field, { target: { value: 'hi' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(streamCalls()).toHaveLength(1), SETTLED);

    // The turn is still running. A `disabled` control cannot hold focus — the browser blurs it
    // and the caret lands on <body> — so the composer must never disable itself mid-turn.
    expect(field.disabled).toBe(false);
    expect(document.activeElement).toBe(field);

    releaseStream();
  });

  it('stays editable while the reply streams, queueing the next prompt instead of sending it', async () => {
    holdStream();
    const field = await focusedComposer();

    fireEvent.change(field, { target: { value: 'first' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(streamCalls()).toHaveLength(1), SETTLED);

    // The composer no longer locks mid-turn — you can compose the next prompt while the reply streams.
    expect(field.readOnly).toBe(false);

    fireEvent.change(field, { target: { value: 'second' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    // That second prompt is queued for after the current reply, not sent as a competing turn.
    expect(streamCalls()).toHaveLength(1);
    expect(screen.getByText('second')).not.toBeNull();

    releaseStream();
  });

  it('leaves the caret in the composer once the reply lands', async () => {
    const field = await focusedComposer();

    fireEvent.change(field, { target: { value: 'hi' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('Sure.')).not.toBeNull(), SETTLED);

    // The next question should be typeable straight away, with no click back into the field.
    expect(field.readOnly).toBe(false);
    expect(document.activeElement).toBe(field);
  });

  it('puts the caret in the composer when sending with the button', async () => {
    const field = await focusedComposer();

    fireEvent.change(field, { target: { value: 'hi' } });
    const button = screen.getByRole('button', { name: 'Send' });
    button.focus(); // a real click focuses the button first
    fireEvent.click(button);

    // The button disables itself the moment it's pressed (busy, and the input just cleared),
    // so focus cannot stay on it. It belongs back in the composer, not on <body>.
    expect(document.activeElement).toBe(field);
    await waitFor(() => expect(screen.getByText('Sure.')).not.toBeNull(), SETTLED);
  });
});

describe('ChatWidget — tool timeline', () => {
  /** Render a fresh chat and wait for the panel to open (role queries can't see inside until then). */
  async function openPanel() {
    render(<ChatWidget />);
    await screen.findByRole('button', { name: 'Minimize' });
  }

  /** The class on a step's <li> encodes its state: 'active' while it runs, 'done' once closed. */
  const stepClass = (label: string) => screen.getByText(label).closest('li')?.className ?? '';

  it('renders each tool step with the human-readable label from the frame', async () => {
    streamFrames = [
      { conversation_id: CID },
      { tool: 'get_facts', label: 'loading facts', status: 'start' },
      { tool: 'get_facts', label: 'loading facts', status: 'end' },
      { text: 'Answer.' },
      { done: true },
    ];
    await openPanel();
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('loading facts')).not.toBeNull(), SETTLED);
  });

  it('prefers the frame label over the local tool-name map', async () => {
    // A label the map would never produce, so it's clear which source won.
    streamFrames = [
      { conversation_id: CID },
      { tool: 'get_facts', label: 'crunching the numbers', status: 'start' },
      { tool: 'get_facts', label: 'crunching the numbers', status: 'end' },
      { text: 'Answer.' },
      { done: true },
    ];
    await openPanel();
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('crunching the numbers')).not.toBeNull(), SETTLED);
    expect(screen.queryByText('loading facts')).toBeNull(); // did not fall back to the map
  });

  it('falls back to the tool-name map when a frame omits the label', async () => {
    streamFrames = [
      { conversation_id: CID },
      { tool: 'read_document', status: 'start' }, // no label
      { tool: 'read_document', status: 'end' },
      { text: 'Answer.' },
      { done: true },
    ];
    await openPanel();
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('reading a document')).not.toBeNull(), SETTLED);
  });

  it('shows a step as running until its end frame arrives', async () => {
    // Hold the stream open right after the start frame, before its matching end.
    streamFrames = [
      { conversation_id: CID },
      { tool: 'get_facts', label: 'loading facts', status: 'start' },
    ];
    streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    await openPanel();
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('loading facts')).not.toBeNull(), SETTLED);
    expect(stepClass('loading facts')).toContain('active');

    releaseStream();
  });

  it('marks a step done once its end frame arrives', async () => {
    streamFrames = [
      { conversation_id: CID },
      { tool: 'get_facts', label: 'loading facts', status: 'start' },
      { tool: 'get_facts', label: 'loading facts', status: 'end' },
      { text: 'Answer.' },
      { done: true },
    ];
    await openPanel();
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('Answer.')).not.toBeNull(), SETTLED);
    expect(stepClass('loading facts')).toContain('done');
  });

  it('keeps the tool steps visible after the reply has finished streaming', async () => {
    streamFrames = [
      { conversation_id: CID },
      { tool: 'get_facts', label: 'loading facts', status: 'start' },
      { tool: 'get_facts', label: 'loading facts', status: 'end' },
      { text: 'All done.' },
      { done: true },
    ];
    await openPanel();
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('All done.')).not.toBeNull(), SETTLED);
    // The finished reply keeps its record of the tools it used — the timeline does not collapse away.
    expect(screen.getByText('loading facts')).not.toBeNull();
  });

  it('closes a still-running step if the turn ends without its end frame', async () => {
    // The reply lands and the stream ends, but get_facts never got its `end` frame — the step must
    // not be left spinning forever (closeOpenTools).
    streamFrames = [
      { conversation_id: CID },
      { tool: 'get_facts', label: 'loading facts', status: 'start' },
      { text: 'Partial.' },
      { done: true },
    ];
    await openPanel();
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('Partial.')).not.toBeNull(), SETTLED);
    await waitFor(() => expect(stepClass('loading facts')).toContain('done'), SETTLED);
  });

  it('shows no separate "thinking" status line — the typing dots are the only pending cue', async () => {
    // Hold the stream open before any reply, to sit in the pending state.
    streamFrames = [{ conversation_id: CID }];
    streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    await openPanel();
    sendMessage('hi');
    await waitFor(() => expect(streamCalls()).toHaveLength(1), SETTLED);

    // The old UI stacked a "thinking" status line under the typing-dots bubble; it's gone.
    expect(screen.queryByText('thinking')).toBeNull();

    releaseStream();
  });
});

describe('ChatWidget — streaming errors', () => {
  /** Render a fresh chat and wait for the panel to open (role queries can't see inside until then). */
  async function openPanel() {
    render(<ChatWidget />);
    await screen.findByRole('button', { name: 'Minimize' });
  }

  it('surfaces the error message and the raw detail from an error frame', async () => {
    streamFrames = [
      { conversation_id: CID },
      { error: 'The assistant hit a snag.', detail: 'ProviderError: upstream 500' },
      { done: true },
    ];
    await openPanel();
    sendMessage('hi');

    // The friendly message replaces the old generic apology...
    await waitFor(() => expect(screen.getByText('⚠️ The assistant hit a snag.')).not.toBeNull(), SETTLED);
    // ...and the owner-only raw cause is shown for diagnosis (the whole panel is owner-gated).
    expect(screen.getByText('ProviderError: upstream 500')).not.toBeNull();
  });

  it('shows just the message when the error frame carries no detail', async () => {
    streamFrames = [{ conversation_id: CID }, { error: 'Something broke.' }, { done: true }];
    await openPanel();
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('⚠️ Something broke.')).not.toBeNull(), SETTLED);
  });

  it('keeps a partial answer and appends the error below it', async () => {
    streamFrames = [
      { conversation_id: CID },
      { text: 'Here is the start of an answer.' },
      { error: 'Then it failed.', detail: 'boom' },
      { done: true },
    ];
    await openPanel();
    sendMessage('hi');

    // An error can arrive after text has streamed; the partial answer must not be thrown away.
    await waitFor(() => expect(screen.getByText('boom')).not.toBeNull(), SETTLED);
    const bubble = screen.getByText('boom').closest('.sfchat-bubble');
    expect(bubble?.textContent).toContain('Here is the start of an answer.');
    expect(bubble?.textContent).toContain('Then it failed.');
  });

  it('offers a Retry that re-sends the failed message and shows the recovered reply', async () => {
    streamFrames = [
      { conversation_id: CID },
      { error: 'Temporary glitch.', detail: 'timeout' },
      { done: true },
    ];
    await openPanel();
    sendMessage('ask something');

    const retry = await screen.findByRole('button', { name: 'Retry' }, SETTLED);
    expect(streamCalls()).toHaveLength(1);

    // The backend recovers on the next attempt.
    streamFrames = [{ conversation_id: CID }, { text: 'Recovered answer.' }, { done: true }];
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText('Recovered answer.')).not.toBeNull(), SETTLED);
    // A second stream was opened, and the failed turn was replaced rather than stacked on top.
    expect(streamCalls()).toHaveLength(2);
    expect(screen.queryByText('timeout')).toBeNull();
  });

  it('offers no Retry on a turn that streamed cleanly', async () => {
    streamFrames = [{ conversation_id: CID }, { text: 'All good.' }, { done: true }];
    await openPanel();
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('All good.')).not.toBeNull(), SETTLED);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('ChatWidget — prompt queue', () => {
  /** Render a fresh chat and wait for the panel to open (role queries can't see inside until then). */
  async function openPanel() {
    render(<ChatWidget />);
    await screen.findByRole('button', { name: 'Minimize' });
  }

  /** Hold the stream open after its last frame, so a turn stays "answering" until released. */
  function holdStream() {
    streamFrames = [{ conversation_id: CID }, { text: 'Sure.' }];
    streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
  }

  it('queues a prompt typed while the agent is answering, then sends it when the turn ends', async () => {
    holdStream();
    await openPanel();
    sendMessage('first');
    await waitFor(() => expect(streamCalls()).toHaveLength(1), SETTLED);

    // Submitted mid-answer → listed under "Up next", not sent as a competing turn.
    sendMessage('second');
    expect(streamCalls()).toHaveLength(1);
    expect(screen.getByText('Up next · sends automatically')).not.toBeNull();
    expect(screen.getByText('second')).not.toBeNull();

    // Releasing the first reply lets the queued prompt fire on its own, and clears the queue.
    releaseStream();
    await waitFor(() => expect(streamCalls()).toHaveLength(2), SETTLED);
    await waitFor(() => expect(screen.queryByText('Up next · sends automatically')).toBeNull(), SETTLED);
  });

  it('sends all queued prompts together as one combined follow-up turn', async () => {
    holdStream();
    await openPanel();
    sendMessage('first');
    await waitFor(() => expect(streamCalls()).toHaveLength(1), SETTLED);

    sendMessage('second');
    sendMessage('third');
    expect(streamCalls()).toHaveLength(1); // both queued behind the live turn

    // When the turn frees, the whole queue goes out as ONE combined turn (like Claude Code) —
    // a single extra stream, not one per prompt — and both prompts ride in the same message.
    releaseStream();
    await waitFor(() => expect(streamCalls()).toHaveLength(2), SETTLED);
    const bubble = screen.getByText(/second/).closest('.sfchat-bubble');
    expect(bubble?.textContent).toContain('second');
    expect(bubble?.textContent).toContain('third');
  });

  it('lets you remove a queued prompt before it sends', async () => {
    holdStream();
    await openPanel();
    sendMessage('first');
    await waitFor(() => expect(streamCalls()).toHaveLength(1), SETTLED);

    sendMessage('regret this');
    fireEvent.click(screen.getByRole('button', { name: 'Remove queued prompt: regret this' }));
    expect(screen.queryByText('regret this')).toBeNull();

    // With the queue empty again, finishing the reply opens no further stream.
    releaseStream();
    await waitFor(() => expect(screen.getByText('Sure.')).not.toBeNull(), SETTLED);
    expect(streamCalls()).toHaveLength(1);
  });
});

describe('ChatWidget — answering model', () => {
  async function openPanel() {
    render(<ChatWidget />);
    await screen.findByRole('button', { name: 'Minimize' });
  }

  /** Stream a turn that reports `model` (or none), and wait for the reply to land. */
  async function answerWithModel(model: string | null) {
    streamFrames = [
      { conversation_id: CID },
      ...(model ? [{ model }] : []),
      { text: 'Answer.' },
      { done: true },
    ];
    await openPanel();
    sendMessage('hi');
    await waitFor(() => expect(screen.getByText('Answer.')).not.toBeNull(), SETTLED);
  }

  /** The header status line — "online", plus the answering model once a turn has replied. */
  const headerStatus = () => document.querySelector('.sfchat-online-label')?.textContent?.trim() ?? '';

  it('names a known model by its friendly name in the header', async () => {
    await answerWithModel('mistral/open-mistral-nemo');
    expect(headerStatus()).toBe('online · Mistral Nemo');
  });

  it('maps the other available models too', async () => {
    await answerWithModel('zai/glm-4.7-flash');
    expect(headerStatus()).toBe('online · GLM 4.7 Flash');
  });

  it('shows the raw id verbatim for an unmapped model — no static fallback', async () => {
    await answerWithModel('acme/mystery-model-9000');
    expect(headerStatus()).toBe('online · acme/mystery-model-9000');
  });

  it('shows just "online" when the turn reports no model', async () => {
    await answerWithModel(null);
    expect(headerStatus()).toBe('online');
  });

  it('no longer shows a per-message model caption under the bubble', async () => {
    await answerWithModel('mistral/open-mistral-nemo');
    expect(document.querySelector('.sfchat-model')).toBeNull();
  });
});

describe('ChatWidget — collapse and reopen', () => {
  it('reopens from the FAB after being minimized', async () => {
    render(<ChatWidget />);
    // Auto-open makes the panel interactive — its Minimize button enters the a11y tree.
    fireEvent.click(await screen.findByRole('button', { name: 'Minimize' }));
    // Collapsed: the panel is aria-hidden, so its controls leave the a11y tree.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Minimize' })).toBeNull());
    // Clicking the FAB must bring it back.
    fireEvent.click(screen.getByRole('button', { name: 'Open the assistant' }));
    expect(await screen.findByRole('button', { name: 'Minimize' })).not.toBeNull();
  });

  it('gates the composer pointer-events on the open panel, so it cannot swallow FAB clicks', () => {
    // The bug was CSS-only: a collapsed panel is pointer-events:none but still laid out over the FAB,
    // and an unscoped `pointer-events: auto` kept the invisible composer clickable, eating the click
    // that reopens the panel. jsdom can't hit-test CSS, so guard the fix at its source — the override
    // must be scoped under `.sfchat-open`.
    render(<ChatWidget />);
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
    expect(css).toMatch(/\.sfchat-open\s+\.sfchat-composer[^{]*\{[^}]*pointer-events:\s*auto/);
  });
});

describe('ChatWidget — rating a message', () => {
  async function openPanel() {
    render(<ChatWidget />);
    await screen.findByRole('button', { name: 'Minimize' });
  }

  const ratedUp = () => screen.getByRole('button', { name: 'Good response' });
  const ratedDown = () => screen.getByRole('button', { name: 'Bad response' });

  it('shows no thumbs until a reply is persisted (has a message id)', async () => {
    // A turn with no ChatMessageIdFrame — the reply was never saved, so there's nothing to rate.
    streamFrames = [{ conversation_id: CID }, { text: 'Unsaved answer.' }, { done: true }];
    await openPanel();
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('Unsaved answer.')).not.toBeNull(), SETTLED);
    expect(screen.queryByRole('button', { name: 'Good response' })).toBeNull();
  });

  it('rates a streamed reply up, PUTting the value to its own message endpoint', async () => {
    streamFrames = [
      { conversation_id: CID },
      { text: 'Here is an answer.' },
      { message_id: 42 },
      { done: true },
    ];
    await openPanel();
    sendMessage('hi');
    const up = await screen.findByRole('button', { name: 'Good response' }, SETTLED);

    fireEvent.click(up);

    await waitFor(() => expect(rateCalls()).toHaveLength(1), SETTLED);
    const call = rateCalls()[0];
    expect(call.url).toBe(`${API}/chat/conversations/${CID}/messages/42/rating/`);
    expect(call.method).toBe('PUT');
    expect(JSON.parse(call.body ?? '{}')).toEqual({ rating: 1 });
    expect(ratedUp().getAttribute('aria-pressed')).toBe('true');
  });

  it('clears the rating when the active thumb is clicked again (sends 0)', async () => {
    streamFrames = [{ conversation_id: CID }, { text: 'A.' }, { message_id: 7 }, { done: true }];
    await openPanel();
    sendMessage('hi');
    const down = await screen.findByRole('button', { name: 'Bad response' }, SETTLED);

    fireEvent.click(down);
    await waitFor(() => expect(rateCalls()).toHaveLength(1), SETTLED);
    expect(JSON.parse(rateCalls()[0].body ?? '{}')).toEqual({ rating: -1 });
    expect(ratedDown().getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(down); // re-click the active thumb → clear
    await waitFor(() => expect(rateCalls()).toHaveLength(2), SETTLED);
    expect(JSON.parse(rateCalls()[1].body ?? '{}')).toEqual({ rating: 0 });
    expect(ratedDown().getAttribute('aria-pressed')).toBe('false');
  });

  it('replaces an up rating with a down when the other thumb is clicked', async () => {
    streamFrames = [{ conversation_id: CID }, { text: 'A.' }, { message_id: 7 }, { done: true }];
    await openPanel();
    sendMessage('hi');
    const up = await screen.findByRole('button', { name: 'Good response' }, SETTLED);

    fireEvent.click(up);
    await waitFor(() => expect(rateCalls()).toHaveLength(1), SETTLED);
    fireEvent.click(ratedDown());

    await waitFor(() => expect(rateCalls()).toHaveLength(2), SETTLED);
    expect(JSON.parse(rateCalls()[1].body ?? '{}')).toEqual({ rating: -1 });
    expect(up.getAttribute('aria-pressed')).toBe('false');
    expect(ratedDown().getAttribute('aria-pressed')).toBe('true');
  });

  it('pre-selects the stored rating on a restored reply', async () => {
    restoreMessages = [
      { id: 1, role: 'user', content: 'A question', rating: null },
      { id: 2, role: 'assistant', content: 'A previously rated answer.', rating: 1 },
    ];
    await renderRestored();

    expect(ratedUp().getAttribute('aria-pressed')).toBe('true');
    expect(ratedDown().getAttribute('aria-pressed')).toBe('false');
  });

  it('rolls the thumb back if the rating request fails', async () => {
    ratingStatus = 500;
    streamFrames = [{ conversation_id: CID }, { text: 'A.' }, { message_id: 9 }, { done: true }];
    await openPanel();
    sendMessage('hi');
    const up = await screen.findByRole('button', { name: 'Good response' }, SETTLED);

    fireEvent.click(up);
    // Reflected optimistically the instant it's clicked — the filled thumb is the feedback.
    expect(up.getAttribute('aria-pressed')).toBe('true');
    // Then rolled back once the backend refuses, so the UI never claims a rating that didn't stick.
    await waitFor(() => expect(up.getAttribute('aria-pressed')).toBe('false'), SETTLED);
  });

  it('offers no thumbs while the reply is still streaming, only once it lands', async () => {
    streamFrames = [{ conversation_id: CID }, { text: 'still going' }, { message_id: 5 }];
    streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    await openPanel();
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('still going')).not.toBeNull(), SETTLED);
    // The turn hasn't ended (stream held open) — no rating controls mid-answer.
    expect(screen.queryByRole('button', { name: 'Good response' })).toBeNull();

    releaseStream();
    await screen.findByRole('button', { name: 'Good response' }, SETTLED);
  });

  it('offers no thumbs on a turn that failed', async () => {
    streamFrames = [{ conversation_id: CID }, { error: 'boom' }, { done: true }];
    await openPanel();
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('⚠️ boom')).not.toBeNull(), SETTLED);
    expect(screen.queryByRole('button', { name: 'Good response' })).toBeNull();
  });
});

describe('ChatWidget — follow-up suggestions', () => {
  async function openPanel() {
    render(<ChatWidget />);
    await screen.findByRole('button', { name: 'Minimize' });
  }

  it('renders the agent follow-ups as chips under the reply', async () => {
    streamFrames = [
      { conversation_id: CID },
      { text: 'Answer.' },
      { suggestions: ['What has he built recently?', 'Where is he based?'] },
      { done: true },
    ];
    await openPanel();
    sendMessage('hi');

    await screen.findByRole('button', { name: 'What has he built recently?' }, SETTLED);
    expect(screen.getByRole('button', { name: 'Where is he based?' })).not.toBeNull();
  });

  it('sends a follow-up as the next message when its chip is clicked', async () => {
    streamFrames = [
      { conversation_id: CID },
      { text: 'Answer.' },
      { suggestions: ['Ask this next'] },
      { done: true },
    ];
    await openPanel();
    sendMessage('hi');
    const chip = await screen.findByRole('button', { name: 'Ask this next' }, SETTLED);

    streamFrames = [{ conversation_id: CID }, { text: 'Follow-up answer.' }, { done: true }];
    fireEvent.click(chip);

    await waitFor(() => expect(streamCalls()).toHaveLength(2), SETTLED);
    // The last stream carried the suggestion as the user's message.
    expect(JSON.parse(streamCalls()[1].body ?? '{}').message).toBe('Ask this next');
    await waitFor(() => expect(screen.getByText('Follow-up answer.')).not.toBeNull(), SETTLED);
  });

  it('drops the follow-ups once a newer turn arrives', async () => {
    streamFrames = [
      { conversation_id: CID },
      { text: 'First.' },
      { suggestions: ['Older follow-up'] },
      { done: true },
    ];
    await openPanel();
    sendMessage('hi');
    await screen.findByRole('button', { name: 'Older follow-up' }, SETTLED);

    streamFrames = [{ conversation_id: CID }, { text: 'Second.' }, { done: true }]; // no suggestions
    sendMessage('again');

    await waitFor(() => expect(screen.getByText('Second.')).not.toBeNull(), SETTLED);
    // The earlier turn's chips belong to the latest reply only — they don't linger under old ones.
    expect(screen.queryByRole('button', { name: 'Older follow-up' })).toBeNull();
  });

  it('shows no follow-up row when the turn sends none', async () => {
    await openPanel(); // default streamFrames carry no suggestions
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('Sure.')).not.toBeNull(), SETTLED);
    // No suggestion frame → no chip row at all.
    expect(document.querySelector('.sfchat-followups')).toBeNull();
  });
});

describe('ChatWidget — public visitor', () => {
  it('renders for a visitor who is not in owner mode', async () => {
    mockInternal.value = false; // a regular visitor — no ?internal=1
    render(<ChatWidget />);
    // The panel mounts and opens for everyone now; it is no longer owner-gated.
    expect(await screen.findByRole('button', { name: 'Minimize' })).not.toBeNull();
  });

  it('hides the raw error detail from a public visitor, keeping the friendly message', async () => {
    mockInternal.value = false;
    streamFrames = [
      { conversation_id: CID },
      { error: 'The assistant hit a snag.', detail: 'ProviderError: upstream 500' },
      { done: true },
    ];
    render(<ChatWidget />);
    await screen.findByRole('button', { name: 'Minimize' });
    sendMessage('hi');

    await waitFor(() => expect(screen.getByText('⚠️ The assistant hit a snag.')).not.toBeNull(), SETTLED);
    // The raw provider exception is owner-only — a regular visitor must never see it.
    expect(screen.queryByText('ProviderError: upstream 500')).toBeNull();
  });
});

// completeMarkdown HOLDS an unclosed trailing token — truncating at its opening marker so the parser
// never sees a half-open construct (which would render raw, then collapse when it closes = the flip).
// The held text reappears the instant the token closes. Appending a closer can't work: CommonMark
// won't close a delimiter that hugs whitespace ("**word "). A whole-file prefix simulation guards
// that this yields zero non-monotonic renders (see the _flip diagnostic used during development).
// completeMarkdown closes an open inline construct so it renders formatted LIVE (bold from its first
// character), with the closer placed before any trailing whitespace (CommonMark won't close a
// delimiter that hugs a space) and an empty just-opened marker dropped. This keeps the width stable
// (no plain→bold jump that re-wraps the line) and never hands the parser a half-open token that could
// flip. A full-file prefix simulation during development confirmed zero non-monotonic renders.
describe('streaming markdown — completeMarkdown closes open tokens live (no flip, no reflow)', () => {
  it('closes an open bold so it renders bold immediately, growing as it streams', () => {
    expect(completeMarkdown('this is **impor')).toBe('this is **impor**');
    expect(completeMarkdown('this is **important**')).toBe('this is **important**');
  });

  it('places the closer before trailing whitespace, and drops an empty just-opened marker', () => {
    expect(completeMarkdown('this is **senior ')).toBe('this is **senior** '); // not "**senior **"
    expect(completeMarkdown('this is **')).toBe('this is '); // empty open → dropped, no "****"
  });

  it('closes unclosed inline code, and closes an unterminated code fence', () => {
    expect(completeMarkdown('run `npm i')).toBe('run `npm i`');
    expect(completeMarkdown('```js\nconst a = 1')).toBe('```js\nconst a = 1\n```');
  });

  it('closes an unclosed lone-star italic', () => {
    expect(completeMarkdown('a *wor')).toBe('a *wor*');
    expect(completeMarkdown('a *word*')).toBe('a *word*');
  });

  it('holds a half-formed trailing link in every shape, incl. [text] before the url', () => {
    expect(completeMarkdown('see my [C')).toBe('see my '); //             [partial-text
    expect(completeMarkdown('see my [CV]')).toBe('see my '); //           [text]  ← the flip case
    expect(completeMarkdown('see my [CV](https://exa')).toBe('see my '); // [text](partial-url
  });

  it('leaves a complete trailing code fence intact (never truncates its closing ```)', () => {
    const withFence = 'note\n\n```\nboom\n```';
    expect(completeMarkdown(withFence)).toBe(withFence);
  });

  it('leaves already-complete markdown untouched', () => {
    const done = 'done **bold** and `code` and [x](https://y)';
    expect(completeMarkdown(done)).toBe(done);
  });
});

