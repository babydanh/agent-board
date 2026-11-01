/**
 * agentBoard: the agents the board shows as cards beside the company's tasks.
 *
 * A herdr pane, or a company session that holds no task, is an agent with work
 * of its own. The board lists the ones that are moving or waiting on the user,
 * each in the lane its status names: working in Đang làm, blocked on the user in
 * Chờ bạn, finished in Xong. An idle agent is not a card, because an idle pane is
 * a place to start work, not work in progress.
 *
 * Two kinds of agent never get a card of their own:
 *  - a session or herdr pane that already holds a task, plans a prompt or runs a
 *    work item: that card speaks for it, and listing it twice would miscount; a
 *    pane whose item is finished is left out only while it reads "done" too;
 *  - a crashed session: every board restart leaves its earlier runs crashed, and
 *    the sidebar folds them for that reason. Herdr has no error status at all,
 *    so no pane reaches Lỗi either.
 *
 * Pure and DOM-free; the board renders these and the tests read them.
 */

import type { CompanySessionSummary, HerdrAgent } from '../../../core/src/company.js';
import type { CompanySessionLogEntry, ProjectTreeNode } from '../../../core/src/messages.js';
import type { AgentTone } from './agentSidebarView.js';
import { herdrSummary, pendingQuestionSessionIds, repoPlacement } from './agentSidebarView.js';
import type { CompanyViewState, HerdrScreenView, HerdrView } from './companyState.js';
import type { CompanyLaneId } from './constants.js';
import { parseCloudNodeId } from './fleet/cloudNodes.js';
import { HERDR_TONE_LABELS, type HerdrTone, herdrToneFor } from './herdrView.js';
import { companyRoleLabel } from './roleProfiles.js';
import { screenActivityLine } from './screenActivity.js';
import { sessionStatusLabel } from './statusLabels.js';
import { parseAnsiScreen } from './terminalScreen.js';

/** What an agent card stands for: a herdr pane, a company session, or a tmux session on a cloud machine. */
export type AgentCardSubject =
  | { kind: 'herdr'; paneId: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'cloud'; machine: string; session: string };

export interface AgentBoardCard {
  /** Stable identity across renders: the React key and the flight key. */
  key: string;
  subject: AgentCardSubject;
  lane: CompanyLaneId;
  /** The status dot's tone: a herdr tone for a pane, a session tone for a session. */
  tone: AgentTone | HerdrTone;
  /** The small tag: "herdr" for a pane, "cloud" for a cloud session, the role's label for a session. */
  tag: string;
  /** The repo, workspace or folder a pane works in; the session code for a session. */
  project: string;
  /** One line: the pane's title or folder, or the session's name. */
  title: string;
  /** The status word the card prints. */
  statusLabel: string;
  /** The git branch a pane works on; null when herdr reported none, and for a session. */
  branch: string | null;
  /** The git checkout a pane works in (herdr's worktree root), whose changes the card counts; null when unknown, and for a session. */
  checkout: string | null;
  /** The line the agent is doing now, from its screen or log; null when neither shows one. */
  activity: string | null;
  /** When the agent last changed, as an ISO time; null when none is known. */
  updatedAt: string | null;
}

/**
 * The lane an agent's tone shows in. Idle, error and parked tones have no lane
 * here, so they are not cards.
 */
function laneForTone(tone: AgentTone | HerdrTone): CompanyLaneId | null {
  switch (tone) {
    case 'working':
      return 'running';
    case 'needs':
      return 'needs_input';
    case 'done':
      return 'done';
    default:
      return null;
  }
}

/** The tone a company session shows; null when the session is not live work. */
function sessionTone(
  session: CompanySessionSummary,
  questioning: ReadonlySet<string>,
): AgentTone | null {
  if (questioning.has(session.id)) return 'needs';
  if (session.status === 'starting' || session.status === 'busy') return 'working';
  if (session.status === 'waiting_input') return 'needs';
  return null;
}

/** Collapse a line to single spaces and bound its length for a card. */
function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

/** A pane's activity line from its screen text; null when herdr has sent no screen. */
function paneActivity(text: string | undefined): string | null {
  if (text === undefined) return null;
  const plain = parseAnsiScreen(text).map((line) => line.map((segment) => segment.text).join(''));
  return screenActivityLine(plain);
}

/** A session's newest logged line of text, collapsed; null when no entry has text. */
function latestLogLine(entries: readonly CompanySessionLogEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry: CompanySessionLogEntry | undefined = entries[i];
    const line = collapseSpaces(entry?.text ?? '');
    if (line !== '') return line;
  }
  return null;
}

function herdrCard(agent: HerdrAgent, screen: HerdrScreenView | undefined): AgentBoardCard | null {
  const tone = herdrToneFor(agent.status);
  const lane = laneForTone(tone);
  if (lane === null) return null;
  return {
    key: `herdr:${agent.paneId}`,
    subject: { kind: 'herdr', paneId: agent.paneId },
    lane,
    tone,
    tag: 'herdr',
    project: repoPlacement(agent).label,
    title: herdrSummary(agent.title, agent.cwd)?.text ?? `${agent.kind} · ${agent.paneId}`,
    statusLabel: HERDR_TONE_LABELS[tone],
    branch: agent.branch || null,
    checkout: agent.worktreeRoot || null,
    activity: paneActivity(screen?.text),
    updatedAt: screen?.at ?? null,
  };
}

function sessionCard(
  session: CompanySessionSummary,
  questioning: ReadonlySet<string>,
  entries: readonly CompanySessionLogEntry[],
): AgentBoardCard | null {
  const tone = sessionTone(session, questioning);
  const lane = tone === null ? null : laneForTone(tone);
  if (tone === null || lane === null) return null;
  return {
    key: `session:${session.id}`,
    subject: { kind: 'session', sessionId: session.id },
    lane,
    tone,
    tag: companyRoleLabel(session.role),
    project: session.code,
    title: session.name,
    statusLabel: tone === 'needs' ? HERDR_TONE_LABELS.needs : sessionStatusLabel(session.status),
    branch: null,
    checkout: null,
    activity: latestLogLine(entries),
    updatedAt: session.lastUsedAt,
  };
}

const KIND_ORDER: Readonly<Record<AgentCardSubject['kind'], number>> = {
  herdr: 0,
  session: 1,
  cloud: 2,
};

/**
 * Herdr panes first, then company sessions, then cloud sessions; within each kind,
 * by project and then by identity, so the same board reads the same way on every render.
 */
function compareAgentCards(left: AgentBoardCard, right: AgentBoardCard): number {
  if (left.subject.kind !== right.subject.kind) {
    return KIND_ORDER[left.subject.kind] - KIND_ORDER[right.subject.kind];
  }
  return (
    left.project.localeCompare(right.project, 'en', { numeric: true }) ||
    left.key.localeCompare(right.key, 'en', { numeric: true })
  );
}

function herdrCards(
  herdr: HerdrView,
  carded: ReadonlySet<string>,
  finishedPanes: ReadonlySet<string>,
): AgentBoardCard[] {
  if (!herdr.loaded || !herdr.available) return [];
  const cards: AgentBoardCard[] = [];
  for (const agent of herdr.agents) {
    if (carded.has(agent.paneId)) continue;
    const card = herdrCard(agent, herdr.screens[agent.paneId]);
    if (card === null || (card.lane === 'done' && finishedPanes.has(agent.paneId))) continue;
    cards.push(card);
  }
  return cards;
}

/**
 * The agent cards for the board, sorted. `carded` holds the session ids and pane ids a task, a
 * planning card or a live work item already shows; `finishedPanes` the panes of finished items,
 * left out while they read "done". Both are left out here.
 */
export function buildAgentCards(
  state: CompanyViewState,
  carded: ReadonlySet<string>,
  finishedPanes: ReadonlySet<string> = new Set(),
): AgentBoardCard[] {
  const questioning = pendingQuestionSessionIds(state);
  const cards = herdrCards(state.herdr, carded, finishedPanes);
  for (const session of Object.values(state.sessions)) {
    if (carded.has(session.id)) continue;
    const card = sessionCard(session, questioning, state.sessionLogs[session.id]?.entries ?? []);
    if (card !== null) cards.push(card);
  }
  return cards.sort(compareAgentCards);
}

/**
 * The lane and tone a cloud session's tree state shows. A free (idle) session, a sleeping one and an unknown one are not
 * work in progress, so they are not cards, as a free herdr pane is not.
 */
const CLOUD_LANE_BY_STATE: Readonly<Record<string, { lane: CompanyLaneId; tone: AgentTone | HerdrTone }>> = {
  working: { lane: 'running', tone: 'working' },
  waiting_input: { lane: 'needs_input', tone: 'needs' },
  done: { lane: 'done', tone: 'done' },
};

const CLOUD_STATUS_LABELS: Readonly<Record<string, string>> = {
  working: HERDR_TONE_LABELS.working,
  waiting_input: HERDR_TONE_LABELS.needs,
  done: 'vừa xong, chờ xem',
};

/**
 * The cloud sessions of the Project tree as agent cards, so the board shows them as it shows a local agent:
 * working in Đang làm, waiting on a menu in Chờ bạn (with what it asks), just finished in Xong. A free or sleeping
 * session is not a card.
 */
export function cloudAgentCards(nodes: readonly ProjectTreeNode[]): AgentBoardCard[] {
  const cards: AgentBoardCard[] = [];
  for (const node of nodes) {
    const cloud = node.kind === 'session' ? parseCloudNodeId(node.id) : null;
    const place = node.state === undefined ? undefined : CLOUD_LANE_BY_STATE[node.state];
    if (cloud === null || place === undefined || node.state === undefined) continue;
    cards.push({
      key: node.id,
      subject: { kind: 'cloud', machine: cloud.machine, session: cloud.session },
      lane: place.lane,
      tone: place.tone,
      tag: 'cloud',
      project: cloud.machine,
      title: node.name,
      statusLabel: CLOUD_STATUS_LABELS[node.state] ?? node.state,
      branch: node.branch ?? null,
      checkout: null,
      activity: node.lastRequest ?? null,
      updatedAt: null,
    });
  }
  return cards.sort(compareAgentCards);
}
