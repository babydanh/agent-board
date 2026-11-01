import { describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import { CloudControl, type CloudControlDeps, type InstaboxResult } from '../src/fleet/cloudControl.js';
import { FLEET_HISTORY_MAX_BYTES } from '../src/fleet/constants.js';
import { handleFleetMessage } from '../src/fleet/handler.js';

function fakeCloud(answer: InstaboxResult) {
  const calls: { args: readonly string[] }[] = [];
  const deps: CloudControlDeps = {
    listConfigHomes: async () => ['/config'],
    run: async (args) => {
      calls.push({ args });
      return args[0] === 'ls' ? { code: 0, stdout: '[{"name":"danh"}]', stderr: '' } : answer;
    },
    launcher: { file: 'instabox', args: [] },
    now: () => 1_000,
    forward: async () => ({ localPort: 40_001, alive: () => true, stop: () => undefined }),
  };
  return { cloud: new CloudControl(deps), calls };
}

describe('CloudControl.readHistory', () => {
  it('captures the whole tmux history of one session with colours, newest bytes kept', async () => {
    const { cloud, calls } = fakeCloud({ code: 0, stdout: 'line 1\nline 2\n', stderr: '' });

    await expect(cloud.readHistory('danh', 'heloo-74pr')).resolves.toEqual({ text: 'line 1\nline 2\n', truncated: false });

    const exec = calls.find((call) => call.args[0] === 'exec');
    expect(exec?.args.slice(0, 5)).toEqual(['exec', 'danh', '--timeout', '60', '--']);
    expect(exec?.args[5]).toContain("tmux capture-pane -p -e -J -S -50000 -t 'heloo-74pr'");
    expect(exec?.args[5]).toContain(`tail -c ${FLEET_HISTORY_MAX_BYTES + 1}`);
    // The pipe into tail would hide tmux's own failure (a missing session answered "ok"): tmux's status is checked first.
    expect(exec?.args[5]).toContain('|| { echo "$out"; exit 1; }');
  });

  it('cuts an over-long history at the front, on a line boundary, and says so', async () => {
    const tail = 'x'.repeat(FLEET_HISTORY_MAX_BYTES - 7);
    const { cloud } = fakeCloud({ code: 0, stdout: `half-cut-line\n${tail}\nlast\n`, stderr: '' });

    const history = await cloud.readHistory('danh', 'heloo-74pr');

    expect(history.truncated).toBe(true);
    expect(history.text.startsWith('half-cut-line')).toBe(false);
    expect(history.text.endsWith('last\n')).toBe(true);
    expect(Buffer.byteLength(history.text)).toBeLessThanOrEqual(FLEET_HISTORY_MAX_BYTES);
  });

  it('reports the reason when the session does not exist', async () => {
    const { cloud } = fakeCloud({ code: 1, stdout: "can't find session: nope\n", stderr: '' });

    await expect(cloud.readHistory('danh', 'nope')).rejects.toMatchObject({ code: 'failed', message: "can't find session: nope" });
  });

  it('rejects a session name that could reach the remote shell before any exec', async () => {
    const { cloud, calls } = fakeCloud({ code: 0, stdout: '', stderr: '' });

    await expect(cloud.readHistory('danh', "x'; rm -rf ~; '")).rejects.toMatchObject({ code: 'bad_input' });
    await expect(cloud.readHistory('Danh 1', 'heloo-74pr')).rejects.toMatchObject({ code: 'bad_input' });
    expect(calls).toEqual([]);
  });
});

describe('fleetHistoryRequest', () => {
  it('answers a privileged request with the session text', async () => {
    const { cloud } = fakeCloud({ code: 0, stdout: 'old\nnew\n', stderr: '' });
    const sent: ServerMessage[] = [];

    const handled = handleFleetMessage({ type: 'fleetHistoryRequest', requestId: 'r1', machine: 'danh', session: 'heloo-74pr' }, (m) => sent.push(m), {
      cloud,
      ledger: null,
      privileged: true,
    });

    expect(handled).toBe(true);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ type: 'fleetHistory', requestId: 'r1', machine: 'danh', session: 'heloo-74pr', text: 'old\nnew\n', truncated: false });
  });

  it('refuses an unprivileged connection and runs nothing', () => {
    const { cloud, calls } = fakeCloud({ code: 0, stdout: 'secret\n', stderr: '' });
    const sent: ServerMessage[] = [];

    handleFleetMessage({ type: 'fleetHistoryRequest', requestId: 'r2', machine: 'danh', session: 'heloo-74pr' }, (m) => sent.push(m), {
      cloud,
      ledger: null,
      privileged: false,
    });

    expect(sent).toEqual([expect.objectContaining({ code: 'forbidden' })]);
    expect(calls).toEqual([]);
  });
});
