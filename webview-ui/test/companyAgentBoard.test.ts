import { describe, expect, it } from 'vitest';

import type { HerdrAgent } from '../../core/src/company.js';
import type {
  CompanyPromptSummary,
  CompanySessionLogEntry,
  ProjectTreeNode,
  ServerMessage,
} from '../../core/src/messages.js';
import { type AgentBoardCard, buildAgentCards, cloudAgentCards } from '../src/company/agentBoard.js';
import { buildBoardLanes } from '../src/company/boardView.js';
import { applyCompanyMessage, type CompanyViewState } from '../src/company/companyState.js';
import { HERDR_TONE_LABELS } from '../src/company/herdrView.js';
import { companyRoleLabel } from '../src/company/roleProfiles.js';
import { sessionStatusLabel } from '../src/company/statusLabels.js';
import { question, session, stateFrom, task } from './companyFixtures.js';

function herdrAgent(overrides: Partial<HerdrAgent> = {}): HerdrAgent {
  return {
    paneId: 'pane-1',
    kind: 'claude',
    status: 'working',
    workspaceId: 'ws-1',
    name: 'claude-1',
    ...overrides,
  };
}

/** The view state after herdr answers with these agents. */
function withHerdr(
  state: CompanyViewState,
  agents: HerdrAgent[],
  available = true,
): CompanyViewState {
  return applyCompanyMessage(state, {
    type: 'herdrAgents',
    available,
    agents,
    sleeping: [],
  } satisfies ServerMessage).state;
}

/** Each card's lane, keyed by the card's key: independent of sort order. */
function laneByKey(cards: AgentBoardCard[]): Record<string, string> {
  return Object.fromEntries(cards.map((card): [string, string] => [card.key, card.lane]));
}

/** A session log entry with a fixed time and run; only its seq and text vary. */
function logEntry(seq: number, text: string): CompanySessionLogEntry {
  return { seq, at: '2026-10-02T10:19:00.000Z', kind: 'text', runEpoch: 1, text };
}

describe('herdr panes as agent cards', () => {
  it('shows working, blocked and done panes in their lanes and leaves idle and unknown ones out', () => {
    const state = withHerdr(stateFrom(), [
      herdrAgent({ paneId: 'p-work', status: 'working' }),
      herdrAgent({ paneId: 'p-block', status: 'blocked' }),
      herdrAgent({ paneId: 'p-done', status: 'done' }),
      herdrAgent({ paneId: 'p-idle', status: 'idle' }),
      herdrAgent({ paneId: 'p-unknown', status: 'unknown' }),
    ]);

    expect(laneByKey(buildAgentCards(state, new Set()))).toEqual({
      'herdr:p-work': 'running',
      'herdr:p-block': 'needs_input',
      'herdr:p-done': 'done',
    });
  });

  it('prints the herdr tag, the status word and the pane title', () => {
    const state = withHerdr(stateFrom(), [herdrAgent({ paneId: 'p-1', title: 'LEDGER refactor' })]);

    expect(buildAgentCards(state, new Set())[0]).toMatchObject({
      key: 'herdr:p-1',
      subject: { kind: 'herdr', paneId: 'p-1' },
      tag: 'herdr',
      title: 'LEDGER refactor',
      statusLabel: HERDR_TONE_LABELS.working,
    });
  });

  it('falls back to the agent kind and pane when herdr gave no title or folder', () => {
    const state = withHerdr(stateFrom(), [herdrAgent({ paneId: 'p-9', title: undefined })]);

    expect(buildAgentCards(state, new Set())[0]?.title).toBe('claude · p-9');
  });

  it('carries the pane branch, its activity line and when the screen last changed', () => {
    const state = withHerdr(stateFrom(), [herdrAgent({ paneId: 'p-2', branch: 'feat/cards' })]);
    const withScreen: CompanyViewState = {
      ...state,
      herdr: {
        ...state.herdr,
        screens: {
          'p-2': {
            paneId: 'p-2',
            text: 'build ok\n\n\nrunning tests\n',
            at: '2026-10-02T10:05:00.000Z',
          },
        },
      },
    };

    expect(buildAgentCards(withScreen, new Set())[0]).toMatchObject({
      branch: 'feat/cards',
      activity: 'running tests',
      updatedAt: '2026-10-02T10:05:00.000Z',
    });
  });

  it('leaves branch, activity and update time empty when herdr has sent none', () => {
    const state = withHerdr(stateFrom(), [herdrAgent({ paneId: 'p-3' })]);

    expect(buildAgentCards(state, new Set())[0]).toMatchObject({
      branch: null,
      activity: null,
      updatedAt: null,
    });
  });

  it('draws no herdr cards while herdr is unavailable', () => {
    const state = withHerdr(stateFrom(), [herdrAgent()], false);

    expect(buildAgentCards(state, new Set())).toEqual([]);
  });

  it('leaves out a pane a work item speaks for, and a done pane only while its item is finished', () => {
    const state = withHerdr(stateFrom(), [
      herdrAgent({ paneId: 'p-item', status: 'working' }),
      herdrAgent({ paneId: 'p-finished', status: 'done' }),
      herdrAgent({ paneId: 'p-new-work', status: 'working' }),
      herdrAgent({ paneId: 'p-free', status: 'done' }),
    ]);

    // p-new-work finished an item earlier and now runs something no item holds: it stays a card.
    const finished = new Set(['p-finished', 'p-new-work']);
    expect(laneByKey(buildAgentCards(state, new Set(['p-item']), finished))).toEqual({
      'herdr:p-new-work': 'running',
      'herdr:p-free': 'done',
    });
  });
});

describe('company sessions as agent cards', () => {
  it('shows live sessions by status and leaves idle, parked and crashed ones out', () => {
    const state = stateFrom({
      sessions: [
        session({ id: 's-busy', status: 'busy' }),
        session({ id: 's-start', status: 'starting' }),
        session({ id: 's-wait', status: 'waiting_input' }),
        session({ id: 's-idle', status: 'idle' }),
        session({ id: 's-parked', status: 'parked' }),
        session({ id: 's-crashed', status: 'crashed' }),
      ],
    });

    expect(laneByKey(buildAgentCards(state, new Set()))).toEqual({
      'session:s-busy': 'running',
      'session:s-start': 'running',
      'session:s-wait': 'needs_input',
    });
  });

  it('moves a busy session to Chờ bạn while it has a pending question', () => {
    const state = stateFrom({
      sessions: [session({ id: 's-busy', status: 'busy' })],
      questions: [question({ sessionId: 's-busy' })],
    });

    expect(buildAgentCards(state, new Set())[0]).toMatchObject({
      key: 'session:s-busy',
      lane: 'needs_input',
      statusLabel: HERDR_TONE_LABELS.needs,
    });
  });

  it('shows the newest logged line of a session and when it was last used', () => {
    const state = applyCompanyMessage(
      stateFrom({ sessions: [session({ id: 's-log', lastUsedAt: '2026-10-02T10:20:00.000Z' })] }),
      {
        type: 'companySessionLog',
        sessionId: 's-log',
        replay: true,
        entries: [
          logEntry(1, 'reading the spec'),
          logEntry(2, '   '),
          logEntry(3, 'writing   the fix'),
        ],
      } satisfies ServerMessage,
    ).state;

    expect(buildAgentCards(state, new Set())[0]).toMatchObject({
      branch: null,
      activity: 'writing the fix',
      updatedAt: '2026-10-02T10:20:00.000Z',
    });
  });

  it('prints the role label, code, name and status of a session', () => {
    const state = stateFrom({
      sessions: [
        session({
          id: 's-1',
          code: 'PA-S0007',
          name: 'Builder',
          role: 'worker',
          status: 'busy',
        }),
      ],
    });

    expect(buildAgentCards(state, new Set())[0]).toMatchObject({
      key: 'session:s-1',
      subject: { kind: 'session', sessionId: 's-1' },
      tag: companyRoleLabel('worker'),
      project: 'PA-S0007',
      title: 'Builder',
      statusLabel: sessionStatusLabel('busy'),
    });
  });

  it('leaves out sessions the caller already shows as cards', () => {
    const state = stateFrom({
      sessions: [
        session({ id: 's-carded', status: 'busy' }),
        session({ id: 's-free', status: 'busy' }),
      ],
    });

    expect(laneByKey(buildAgentCards(state, new Set(['s-carded'])))).toEqual({
      'session:s-free': 'running',
    });
  });
});

describe('agent card order and board dedupe', () => {
  it('lists herdr panes before company sessions, and panes in identity order', () => {
    const state = withHerdr(stateFrom({ sessions: [session({ id: 's-busy', status: 'busy' })] }), [
      herdrAgent({ paneId: 'p10' }),
      herdrAgent({ paneId: 'p2' }),
    ]);

    expect(buildAgentCards(state, new Set()).map((card) => card.key)).toEqual([
      'herdr:p2',
      'herdr:p10',
      'session:s-busy',
    ]);
  });

  it('shows a session that holds a task only as that task card', () => {
    const state = stateFrom({
      sessions: [session({ id: 's-task', status: 'busy' })],
      tasks: [task({ sessionId: 's-task' })],
    });

    expect(buildBoardLanes(state).flatMap((lane) => lane.agents)).toEqual([]);
  });

  it('shows a Director planning a prompt only as its planning card', () => {
    const prompt: CompanyPromptSummary = {
      id: 'prompt-1',
      preview: 'Plan the release',
      createdAt: '2026-10-02T10:00:00.000Z',
      attachments: [],
      targetSessionId: 's-director',
    };
    const state = stateFrom({
      sessions: [session({ id: 's-director', role: 'director', status: 'busy' })],
      prompts: [prompt],
    });

    expect(buildBoardLanes(state).flatMap((lane) => lane.agents)).toEqual([]);
  });

  it('puts each agent card in the lane of its lane id', () => {
    const state = withHerdr(
      stateFrom({ sessions: [session({ id: 's-wait', status: 'waiting_input' })] }),
      [herdrAgent({ paneId: 'p-work', status: 'working' })],
    );
    const lanes = buildBoardLanes(state);

    expect(lanes.find((lane) => lane.id === 'running')?.agents.map((card) => card.key)).toEqual([
      'herdr:p-work',
    ]);
    expect(lanes.find((lane) => lane.id === 'needs_input')?.agents.map((card) => card.key)).toEqual(
      ['session:s-wait'],
    );
  });
});

function cloudNode(overrides: Partial<ProjectTreeNode> & { id: string }): ProjectTreeNode {
  return { kind: 'session', name: 'fix-aqp', ...overrides };
}

describe('cloud sessions as agent cards', () => {
  it('puts a working one in Đang làm, a menu-asking one in Chờ bạn and one that just finished in Xong; a free one is no card', () => {
    const cards = cloudAgentCards([
      cloudNode({ id: 'cloud:danh1/work', name: 'work', state: 'working', branch: 'cloud/danh1-work' }),
      cloudNode({ id: 'cloud:danh1/ask', name: 'ask', state: 'waiting_input', lastRequest: 'Đang hỏi: Which database?' }),
      cloudNode({ id: 'cloud:danh1/fin', name: 'fin', state: 'done' }),
      cloudNode({ id: 'cloud:danh1/rest', name: 'rest', state: 'idle' }),
    ]);

    expect(laneByKey(cards)).toEqual({
      'cloud:danh1/work': 'running',
      'cloud:danh1/ask': 'needs_input',
      'cloud:danh1/fin': 'done',
    });
    // TC-CLOUD-STATE-02: the waiting card says what it asks.
    expect(cards.find((card) => card.key === 'cloud:danh1/ask')?.activity).toBe('Đang hỏi: Which database?');
    expect(cards.find((card) => card.key === 'cloud:danh1/work')).toMatchObject({
      subject: { kind: 'cloud', machine: 'danh1', session: 'work' },
      tag: 'cloud',
      project: 'danh1',
      title: 'work',
      branch: 'cloud/danh1-work',
    });
  });

  it('leaves out a sleeping session, a node that is no cloud session and a group', () => {
    expect(
      cloudAgentCards([
        cloudNode({ id: 'cloud:danh1/gone', state: 'sleeping' }),
        cloudNode({ id: 'local-session', state: 'working' }),
        cloudNode({ id: 'cloud:other', kind: 'group', state: 'working' }),
        cloudNode({ id: 'cloud:danh1/nostate' }),
      ]),
    ).toEqual([]);
  });

  it('reaches the board lanes next to the company agents', () => {
    const state = withHerdr(stateFrom(), [herdrAgent({ paneId: 'p-work', status: 'working' })]);
    const cloud = cloudAgentCards([cloudNode({ id: 'cloud:danh1/work', state: 'working' })]);
    const lanes = buildBoardLanes(state, cloud);

    expect(lanes.find((lane) => lane.id === 'running')?.agents.map((card) => card.key)).toEqual([
      'herdr:p-work',
      'cloud:danh1/work',
    ]);
  });
});
