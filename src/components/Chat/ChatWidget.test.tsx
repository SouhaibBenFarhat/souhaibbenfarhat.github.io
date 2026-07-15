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

type Call = { url: string; method: string };
let calls: Call[] = [];
/** Status the stubbed backend answers DELETE with. */
let deleteStatus = 204;

const deleteCalls = () => calls.filter((c) => c.method === 'DELETE');

beforeEach(() => {
  calls = [];
  deleteStatus = 204;
  localStorage.clear();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method });
      if (method === 'DELETE') {
        return { ok: deleteStatus >= 200 && deleteStatus < 300, status: deleteStatus };
      }
      return { ok: true, status: 200, json: async () => ({ id: CID, messages: RESTORED }) };
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

  it('DELETEs the conversation, then resets to a fresh chat', async () => {
    const trash = await renderRestored();
    fireEvent.click(trash);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // Hits the same URL the restore uses, with the DELETE method.
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0].url).toBe(CONV_URL);

    // The spec tells the client to drop its stored id; the messages go with it.
    await waitFor(() => expect(localStorage.getItem('chat_conversation_id')).toBeNull());
    expect(screen.queryByText('He owns AI features end to end.')).toBeNull();

    // Back to a first-visit chat: the greeting is re-armed (typing indicator, then it types out)
    // and there's nothing left to delete.
    expect(screen.getByLabelText('typing')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).toBeNull();
  });

  it('treats a 404 as already deleted and still resets', async () => {
    deleteStatus = 404; // the thread was gone server-side (e.g. the free DB was reset)
    const trash = await renderRestored();
    fireEvent.click(trash);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(localStorage.getItem('chat_conversation_id')).toBeNull());
    expect(screen.queryByText('He owns AI features end to end.')).toBeNull();
  });

  it('keeps the conversation and offers a retry when the delete fails', async () => {
    deleteStatus = 500;
    const trash = await renderRestored();
    fireEvent.click(trash);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // The privacy page promises the data is really gone, so a failed delete must not clear
    // the UI and imply success — the thread stays until the backend confirms.
    await waitFor(() => expect(screen.getByText('Couldn’t delete.')).not.toBeNull());
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull();
    expect(localStorage.getItem('chat_conversation_id')).toBe(CID);
    expect(screen.getByText('He owns AI features end to end.')).not.toBeNull();
  });

  it('retrying after a failure deletes and resets', async () => {
    deleteStatus = 500;
    const trash = await renderRestored();
    fireEvent.click(trash);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('button', { name: 'Retry' });

    deleteStatus = 204; // backend recovers
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(localStorage.getItem('chat_conversation_id')).toBeNull());
    expect(deleteCalls()).toHaveLength(2);
    expect(screen.queryByText('He owns AI features end to end.')).toBeNull();
  });
});
