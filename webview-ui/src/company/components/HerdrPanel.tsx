/**
 * HerdrPanel: one herdr agent, seen and driven from the board.
 *
 * The screen is the agent's own terminal as herdr shows it. While the screen tab is open the server
 * pushes each change to the pane's screen, and the screen is also read on open and on every status
 * change. Holding or selecting text in the screen freezes it, with a chip that says so, and the newest
 * screen lands once the selection lets go. The screen opens at its newest line and follows it until
 * the reader scrolls up. The choice keys appear only while the agent waits on a choice. Prompts to the
 * agent go through the board's one composer at the bottom, which targets the agent open here.
 */

import type { RefObject } from 'react';
import { useContext, useEffect, useRef, useState } from 'react';

import type { HerdrKey } from '../../../../core/src/messages.js';
import { failureNotice } from '../commandResults.js';
import type { CompanyClient, CompanyCommandHandle } from '../companyClient.js';
import type { CompanyViewState } from '../companyState.js';
import {
  HERDR_CHOICE_KEYS,
  HERDR_DRAWER_TAB_LABELS,
  type HerdrDrawerTab,
  missingPaneView,
  paneStartSteps,
  PERMISSION_MODE_CHOICES,
  permissionModeLabel,
} from '../herdrView.js';
import { formatLogTime } from '../sessionLogView.js';
import { clipRuleRows, MONO_CHAR_EM, screenFitPx, type ScreenLine } from '../terminalScreen.js';
import { useCoalescedFrame } from '../useCoalescedFrame.js';
import { useHerdrScreenWatch } from '../useHerdrScreenWatch.js';
import { useModePicker } from '../useModePicker.js';
import { useNow } from '../useNow.js';
import { useParsedScreen } from '../useParsedScreen.js';
import { useScreenSelection } from '../useScreenSelection.js';
import { useStickToBottom } from '../useStickToBottom.js';
import { WrapLinesContext } from '../wrapLines.js';
import { HerdrInfoTab } from './AgentInfoTab.js';
import { CompanyButton } from './CompanyButton.js';
import { PetLoader } from './PetLoader.js';
import { ScreenFreezeChip } from './ScreenFrame.js';
import { ScreenView } from './ScreenView.js';
import { StartLog } from './StartLog.js';

const HERDR_TABS = ['screen', 'info'] as const satisfies readonly HerdrDrawerTab[];

export interface HerdrPanelProps {
  client: CompanyClient;
  state: CompanyViewState;
  paneId: string;
  /** The tab the panel shows. The drawer owns it, so a request for the info tab survives. */
  tab: HerdrDrawerTab;
  onTabChange: (tab: HerdrDrawerTab) => void;
  /** The board just opened or woke this pane: herdr may not list it yet, so its absence is a wait. */
  starting?: boolean;
}

export function HerdrPanel({ client, state, paneId, tab, onTabChange, starting = false }: HerdrPanelProps) {
  const [openedAt] = useState(() => Date.now());
  const now = useNow();
  const agent = state.herdr.agents.find((entry) => entry.paneId === paneId);
  const status = agent?.status;
  const latest = state.herdr.screens[paneId];
  const [lastRequest, setLastRequest] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const screenRef = useRef<HTMLPreElement>(null);
  const frozen = useScreenSelection(screenRef);
  const live = tab === 'screen' && !frozen;
  const screen = useCoalescedFrame(latest, frozen);
  const screenLines = useParsedScreen(screen?.text ?? '');

  // Read the screen when it comes into view, whenever the agent's status moves, and when a held
  // selection lets go. The watch carries the screen on from each of those reads.
  useEffect(() => {
    if (!live) return undefined;
    const handle = client.herdrRead(paneId);
    setLocalNotice(failureNotice(handle, 'Không gửi được.'));
    return undefined;
  }, [client, paneId, status, live]);
  useHerdrScreenWatch(client, paneId, live);

  // A paste with the screen in view and no field focused goes into the composer, which is how
  // text reaches this agent; a paste inside any field is that field's own.
  const draftText = state.prompt.text;
  useEffect(() => {
    if (tab !== 'screen') return undefined;
    const onPaste = (event: ClipboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]') !== null) return;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (text === '') return;
      event.preventDefault();
      client.setDraftText(draftText + text);
      document.querySelector<HTMLTextAreaElement>('[data-testid="prompt-input"]')?.focus();
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [client, tab, draftText]);

  const lastOutcome = lastRequest === null ? undefined : state.commandResults[lastRequest];
  const notice = localNotice ?? failureNotice(lastOutcome, 'Máy chủ từ chối lệnh này.');

  function track(handle: CompanyCommandHandle): void {
    setLastRequest(handle.requestId);
    setLocalNotice(failureNotice(handle, 'Không gửi được.'));
  }

  function sendKey(key: HerdrKey): void {
    track(client.herdrKeys(paneId, [key]));
  }

  const mode = screen ? permissionModeLabel(screen.text) : null;
  const modePicker = useModePicker(
    mode,
    screen !== undefined,
    () => sendKey('shift+tab'),
    (target) => setLocalNotice(`Không chuyển được sang chế độ ${target ?? 'mặc định'}: phiên này không có chế độ đó trong vòng Shift+Tab, hoặc Claude đang bận.`),
  );

  if (agent === undefined) {
    const missing = missingPaneView(starting, now - openedAt);
    if (missing.loading) {
      return (
        <div data-testid="herdr-pane-starting" className="flex flex-1 flex-col items-center justify-center">
          <PetLoader text={missing.text} />
          <StartLog steps={paneStartSteps(false, false)} since={openedAt} />
        </div>
      );
    }
    return (
      <p role="status" data-testid="herdr-pane-missing" className="p-2 text-2xs text-text-muted">
        {missing.text}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-2 pb-2" data-testid="herdr-panel">
      {/* One row: the tabs, then where the agent works and when the screen was read. */}
      <div className="flex min-w-0 items-center gap-2">
        <nav aria-label="Phần của agent herdr" className="flex shrink-0 gap-1">
          {HERDR_TABS.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => onTabChange(entry)}
              aria-current={tab === entry}
              className={`relative cursor-pointer px-2 py-1 text-2xs ${
                tab === entry
                  ? 'text-text after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {HERDR_DRAWER_TAB_LABELS[entry]}
            </button>
          ))}
        </nav>
        <p
          className="min-w-0 flex-1 truncate text-right text-2xs text-text-muted"
          title={[agent.title, agent.cwd].filter(Boolean).join('\n')}
        >
          {[agent.kind, agent.cwd, screen ? formatLogTime(screen.at) : null].filter(Boolean).join(' · ')}
        </p>
      </div>

      {tab === 'info' ? (
        <HerdrInfoTab
          client={client}
          state={state}
          paneId={paneId}
          fallbackCwd={agent.cwd ?? null}
        />
      ) : (
        <>
          {agent.status === 'blocked' && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Phím gửi tới agent">
              {HERDR_CHOICE_KEYS.map((choice) => (
                <CompanyButton key={choice.key} size="sm" onClick={() => sendKey(choice.key)}>
                  {choice.label}
                </CompanyButton>
              ))}
            </div>
          )}

          {agent.kind === 'claude' && screen && (
            // The CLI only cycles modes (Shift+Tab): the picker presses it until the footer shows the chosen one.
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Chế độ quyền của Claude Code" aria-busy={modePicker.busy}>
              {PERMISSION_MODE_CHOICES.map((choice) => (
                <CompanyButton
                  key={choice.label ?? 'default'}
                  size="sm"
                  variant={choice.label === mode ? 'accent' : 'default'}
                  aria-pressed={choice.label === mode}
                  // aria-disabled, not disabled: a disabled button drops the keyboard focus it was just given.
                  aria-disabled={modePicker.busy}
                  onClick={() => { if (!modePicker.busy) modePicker.choose(choice.label); }}
                >
                  {choice.label ?? 'Mặc định'}
                </CompanyButton>
              ))}
            </div>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
            {frozen && <ScreenFreezeChip />}
            {screen ? (
              <HerdrScreenView lines={screenLines} preRef={screenRef} />
            ) : starting ? (
              <StartLog steps={paneStartSteps(true, false)} since={openedAt} />
            ) : (
              <p className="rounded-(--company-radius-sm) bg-well p-2 text-2xs text-text-muted">
                Chưa đọc màn hình.
              </p>
            )}
          </div>

          {notice && (
            <p role="alert" className="text-2xs text-warning">
              {notice}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The herdr screen, pinned to its newest line until the reader scrolls up. With wrapping on, the
 * font shrinks so the terminal's widest row fits the frame: rows keep their columns, as in herdr.
 */
function HerdrScreenView({
  lines,
  preRef,
}: {
  lines: readonly ScreenLine[];
  preRef: RefObject<HTMLPreElement | null>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const onScroll = useStickToBottom(scrollRef);
  const fit = useContext(WrapLinesContext);
  const [widthPx, setWidthPx] = useState(0);
  const [charEm, setCharEm] = useState(MONO_CHAR_EM);
  useEffect(() => {
    const frame = scrollRef.current;
    if (frame === null) return undefined;
    // contentRect leaves out the frame's padding: only the room the text has.
    const observer = new ResizeObserver(([entry]) => setWidthPx(entry?.contentRect.width ?? 0));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  // The real glyph width of the screen's font, so the widest row fills the frame edge to edge.
  useEffect(() => {
    const pre = preRef.current;
    const context = pre === null ? null : document.createElement('canvas').getContext('2d');
    if (pre === null || context === null) return;
    context.font = `100px ${getComputedStyle(pre).fontFamily}`;
    const measured = context.measureText('0'.repeat(10)).width / 1000;
    if (measured > 0) setCharEm(measured);
  }, [preRef]);
  const fitPx = fit ? screenFitPx(lines, widthPx, charEm) : undefined;
  // Rows wrap at the fitted size, so a full-width divider is cut to the frame instead of folding.
  const shown = fitPx === undefined ? lines : clipRuleRows(lines, Math.floor(widthPx / (fitPx * charEm)));
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 min-w-0 flex-1 overflow-auto rounded-(--company-radius-sm) bg-well p-1.5"
    >
      <ScreenView
        testId="herdr-screen"
        className="min-h-full min-w-full"
        lines={shown}
        preRef={preRef}
        {...(fitPx === undefined ? {} : { fitPx })}
      />
    </div>
  );
}
