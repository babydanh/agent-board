export const AGENT_ENGINES = [
  { id: 'omp', label: 'omp', icon: 'π', launch: 'board' },
  { id: 'claude', label: 'Claude Code', icon: '✳', launch: 'herdr' },
  { id: 'agy', label: 'Antigravity', icon: '▲', launch: 'herdr' },
  { id: 'codex', label: 'Codex', icon: '⌘', launch: 'wrapper' },
  { id: 'pi', label: 'pi / ThinkRail', icon: 'π', launch: 'wrapper' },
  { id: 'thinkrail', label: 'ThinkRail', icon: '◆', launch: 'wrapper' },
] as const;

export type AgentEngine = (typeof AGENT_ENGINES)[number]['id'];
export type AgentLaunch = (typeof AGENT_ENGINES)[number]['launch'];
export type AgentEngineForLaunch<Launch extends AgentLaunch> = Extract<
  (typeof AGENT_ENGINES)[number],
  { launch: Launch }
>['id'];
export type HerdrAgentEngine = AgentEngineForLaunch<'herdr'>;
export type WrapperAgentEngine = AgentEngineForLaunch<'wrapper'>;
export type BoardAgentEngine = AgentEngineForLaunch<'board'>;
export type ProjectSessionEngine = AgentEngine;
export type ProjectTreeEngine = AgentEngine | 'herdr' | 'board';
export type ProjectTreeAgentKind = AgentEngine | 'sub' | 'herdr' | 'board';

export function agentEngineForKind(kind: string | null | undefined): AgentEngine | null {
  const normalized = kind?.toLowerCase();
  if (normalized === 'main' || normalized === 'sub') return 'omp';
  if (normalized === undefined) return null;
  // The activity ledger writes display names ("Claude Code", "claude-code"): the first word is the engine id.
  const word = normalized.split(/[^a-z0-9]+/)[0];
  return AGENT_ENGINES.find((engine) => engine.id === normalized || engine.id === word)?.id ?? null;
}

export function agentEngineForCommand(command: string | undefined): AgentEngine | null {
  if (command === undefined) return null;
  const name = command.trim().split(/[\\/]/).pop()?.toLowerCase().replace(/\.(?:cmd|exe)$/i, '');
  return AGENT_ENGINES.find((engine) => engine.id === name)?.id ?? null;
}

export function isEngineForLaunch<Launch extends AgentLaunch>(
  engine: AgentEngine,
  launch: Launch,
): engine is AgentEngineForLaunch<Launch> {
  return AGENT_ENGINES.some((candidate) => candidate.id === engine && candidate.launch === launch);
}
