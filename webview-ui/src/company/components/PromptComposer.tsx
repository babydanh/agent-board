/**
 * PromptComposer: ONE box that types into the selected omp session.
 *
 * The line is typed into that session's own terminal, the way the keyboard would
 * type it, so OMP handles it as its TUI does: its `/` commands, its steering of a
 * busy session, its editor. The line above the box names the target. The rules
 * live in `composerRouting.ts`:
 *
 *  - Enter, Ctrl/Cmd+Enter and the Send button: the line goes into the selected
 *    session's terminal, followed by Enter (`terminalLine`). The terminal must be
 *    open in the drawer; otherwise the box says so and keeps the text.
 *  - With a herdr agent selected, the plain send types into that agent's pane instead.
 *  - Ctrl/Cmd+Shift+Enter, and the "Công ty" entry of the send menu: the Company workflow
 *    (Director, Contract, approval, workers). A selected Company session becomes the
 *    target; a plain omp chat never does.
 *  - The "Một agent…" entry opens a dialog that gives the text to a chosen agent as a work item.
 *  - Ctrl/Cmd+Alt+Enter, and the "Đội" entry of the send menu: the folder's team, as a squad
 *    run (see `squadView.ts`). It needs no selected session, because a squad is folder-level.
 *  - `/new` opens a new omp chat in this folder, with no prompt. `/resume` opens a
 *    picker over the omp sessions saved here. Neither reaches a terminal.
 *  - Images. Paste, drop or pick an image: the server saves it and its path joins the
 *    text (`promptImages.ts`), since a terminal carries text and agents open images by path.
 *  - Voice. 🎤 or Ctrl+Shift+Space records, the server has Groq write it down; saying
 *    "chụp màn" opens 📸 (whole screen after a countdown, then marked up in
 *    ScreenAnnotateDialog), and a final "gửi đi" sends (`voiceCommands.ts`).
 */

import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { HerdrAgent } from '../../../../core/src/company.js';
import type { OmpSessionEntry } from '../../../../core/src/messages.js';
import { assigneeOptionsFor } from '../assigneeOptions.js';
import { failureNotice } from '../commandResults.js';
import type { CompanyClient } from '../companyClient.js';
import { composerInputHeight } from '../composerHeight.js';
import { composerStorage, readComposerHeight, writeComposerHeight } from '../composerPrefs.js';
import {
  companyRoute,
  planComposerCommand,
  resumeListView,
  sendTargetLabel,
  sleepingSendTarget,
  sleepingTargetLabel,
  startNewChat,
  terminalLine,
  wakeWithLine,
} from '../composerRouting.js';
import { sendMenuEntries, type SendMenuEntryId } from '../composerSendMenu.js';
import { showsAllFolders } from '../folderIdentity.js';
import { focusFolder, FOLDER_LIST_LOADING_MESSAGE, folderListLoading } from '../folderView.js';
import { imageFiles, withoutImagePath } from '../promptImages.js';
import { isCompanyChord, promptBlockReason, type PromptRoute } from '../promptSubmission.js';
import { draftAfterSend, herdrAgentFor, sendPrompt } from '../promptTargets.js';
import { matchShortcut } from '../shortcuts.js';
import {
  commandCompletionQuery,
  commandCompletions,
  ompModelMessage,
  type OmpSlashCommand,
} from '../slashCommands.js';
import { canStartSquad, type SquadStartVerdict } from '../squadView.js';
import { useCompanyState } from '../useCompanyState.js';
import { usePromptImages } from '../usePromptImages.js';
import { CAPTURE_DELAY_SECONDS, captureScreen, useVoiceInput } from '../useVoiceInput.js';
import { readVoiceCommands } from '../voiceCommands.js';
import { workItemsOf } from '../workItemView.js';
import { composerFolderChoices, folderLabelFor } from '../workspaces.js';
import { ComposerSendMenu } from './ComposerSendMenu.js';
import { OmpSessionPicker } from './OmpSessionPicker.js';
import { ScreenAnnotateDialog } from './ScreenAnnotateDialog.js';
import { CreateWorkDialog } from './WorkDialogHost.js';

/** Shown when a line is sent with no session selected. */
const NO_SESSION_NOTICE = 'Chọn một phiên omp để gõ vào, hoặc bấm Phiên mới để mở phiên.';

/** Shown when the selected session's terminal is not open, so the line cannot be typed. */
const TERMINAL_NOT_OPEN_NOTICE =
  'Terminal của phiên chưa mở. Mở tab Terminal của phiên rồi gửi lại.';

/** The keys this box answers to, shown in the `?` tooltip beside the target line. */
const COMPOSER_HINTS =
  'Enter gõ vào phiên đang chọn · Shift+Enter xuống dòng · Ctrl+Shift+Enter để giao cho công ty · Ctrl+Alt+Enter để giao cho đội · Ctrl+Shift+Space nói (nói "chụp màn" để chụp, "gửi đi" để gửi) · /new mở phiên mới · /resume mở phiên đã lưu';

/** Shown when Ctrl/Cmd+Shift+Enter is pressed while a herdr agent is the target. */
const HERDR_COMPANY_NOTICE =
  'Chọn một phiên omp để giao cho công ty. Agent herdr không nhận việc giao này.';

/** Shown when a squad request cannot be sent. */
const SQUAD_FALLBACK = 'Chưa giao được cho đội.';
/** The reason the squad button gives while no folder is in focus. */
const NO_FOLDER_SQUAD_REASON = 'Chưa có thư mục để lập đội.';

/** A row in the completion popup: an OMP command the first token completes to. */
interface CompletionRow {
  command: OmpSlashCommand;
  insert: string;
}

export interface PromptComposerProps {
  client: CompanyClient;
  /** The Project tree's folders: new work can go to any of them, opened or not yet. */
  projectFolders: readonly { path: string; name?: string }[];
  /** The cloud session the drawer shows: a plain send types into it. Returns false when its terminal is not connected. */
  cloudTarget?: { readonly label: string; readonly machine: string; readonly send: (text: string) => boolean };
}

/** One line's height, the padding and border around it, and the height the text needs. */
interface BoxMetrics {
  rowPx: number;
  chromePx: number;
  fitPx: number;
}

/** A handle drag in progress: where the pointer began, the box's height then, its metrics. */
interface ResizeDrag {
  startY: number;
  startPx: number;
  metrics: BoxMetrics;
}

/**
 * Measure the box against its text. The box is set to `auto` first, so the text's own
 * height is what gets measured; the caller sets the height afterwards.
 */
function measureBox(el: HTMLTextAreaElement): BoxMetrics {
  el.style.height = 'auto';
  const style = getComputedStyle(el);
  const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const chromePx = border + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  return { rowPx: parseFloat(style.lineHeight), chromePx, fitPx: el.scrollHeight + border };
}

/**
 * Size the composer's text box to its text: at least COMPOSER_MIN_ROWS rows, a row more for
 * each line up to COMPOSER_MAX_ROWS rows, where it scrolls. A height the user dragged the box
 * to is the floor it keeps.
 */
function fitTextarea(el: HTMLTextAreaElement | null, savedPx: number | null): void {
  if (el === null) return;
  const { rowPx, chromePx, fitPx } = measureBox(el);
  el.style.height = `${composerInputHeight(fitPx, rowPx, chromePx, savedPx)}px`;
}

export function PromptComposer({ client, projectFolders, cloudTarget }: PromptComposerProps) {
  const state = useCompanyState(client);
  const draft = state.prompt;
  const [notice, setNotice] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  /** The request of an open `/resume` picker, or null when no picker is open. */
  const [resumeRequest, setResumeRequest] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  /** The request of a send from this box to a herdr agent whose verdict is still pending. */
  const [herdrRequest, setHerdrRequest] = useState<string | null>(null);
  /** The request of a squad send from this box whose verdict is still pending. */
  const [squadRequest, setSquadRequest] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // An image for a cloud session is kept on that machine, so its path in the text is one the agent can open.
  const images = usePromptImages(client, setNotice, draft.text, cloudTarget?.machine);
  /** The height the user dragged the box to, or null when it has never been dragged. */
  const [savedHeight, setSavedHeight] = useState<number | null>(() =>
    readComposerHeight(composerStorage()),
  );
  const resizeRef = useRef<ResizeDrag | null>(null);

  const selectedSession =
    state.selection.sessionId === null ? null : (state.sessions[state.selection.sessionId] ?? null);
  const selectedModel = selectedSession?.requestedModel ?? state.selectedModel;
  const herdrTarget = herdrAgentFor(state.selection.herdrPaneId, state.herdr.agents);
  // A sleeping session picked on the board: its pane is closed, so a send wakes it with the line.
  const sleepingTarget = sleepingSendTarget(state.selection.herdrPaneId, herdrTarget, state.herdrRoster.sleeping);
  // An image still saving has no path in the draft yet: sending now would leave it out.
  const busy = draft.pendingSubmit !== null || herdrRequest !== null || images.saving > 0;
  const blocker = promptBlockReason(draft);
  // The folder a new session, squad or company prompt goes to. Any Project folder can be picked.
  const focus = focusFolder(state);
  const pickerFolders = composerFolderChoices(state.workspaces, projectFolders);
  // A folder the board has not opened yet is opened first; the view mode the user had stays.
  const pickFolder = (path: string): void => {
    if (pickerFolders.find((entry) => entry.path === path)?.open !== false) {
      client.setFocusFolder(path);
      return;
    }
    const wasAll = showsAllFolders(state);
    client.openWorkspace(path);
    if (wasAll) client.setViewMode('all');
  };
  // Until the server's folder list arrives, a message with no session has no folder to go to.
  const folderLoading = folderListLoading(state);

  // The team a squad request goes to: the folder's agents and sessions. Without a folder, or
  // with nobody to hand work to, the squad button stays off and says why.
  const squadTeam: SquadStartVerdict =
    focus === null
      ? { ok: false, reason: folderLoading ? FOLDER_LIST_LOADING_MESSAGE : NO_FOLDER_SQUAD_REASON }
      : canStartSquad(assigneeOptionsFor(state, focus));
  const newSessionWaits = folderLoading && selectedSession === null;
  // The send menu's entries, each with the reason it is off, from the state the buttons read.
  const sendMenu = sendMenuEntries({
    blocker,
    busy,
    resumeOpen: resumeRequest !== null,
    squadPending: squadRequest !== null,
    squadTeam,
    newSessionWaits,
    herdrTarget: herdrTarget !== null || sleepingTarget !== null,
    hasFocus: focus !== null,
    folderLoading,
    hasText: draft.text.trim() !== '',
  });
  const resumeView =
    resumeRequest === null
      ? null
      : resumeListView(resumeRequest, state.ompSessions, state.commandResults[resumeRequest]);

  // The catalog only names the model in the target line; without it the raw id is
  // shown. Asked once per mount, never polled.
  useEffect(() => {
    if (state.modelCatalog.length === 0) client.requestModelCatalog();
  }, [client, state.modelCatalog.length]);

  // Grow the box with its text, never shorter than the height the user dragged it to.
  // Wrapping changes with the window width, so re-measure on resize too.
  useLayoutEffect(() => fitTextarea(inputRef.current, savedHeight), [draft.text, savedHeight]);
  useEffect(() => {
    const refit = () => fitTextarea(inputRef.current, savedHeight);
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  }, [savedHeight]);

  // OMP's status line names the model as `provider/id`
  // (builtin-modes.ts:456-459). A model the server holds but this catalog does
  // not list is shown raw rather than guessed at.
  const modelEntry =
    selectedModel === null
      ? null
      : (state.modelCatalog.find((entry) => entry.id === selectedModel) ?? null);
  const modelLabel =
    selectedModel === null
      ? ompModelMessage('current', '')
      : ompModelMessage(
          'current',
          modelEntry === null ? selectedModel : `${modelEntry.provider}/${modelEntry.model}`,
        );

  const rows: readonly CompletionRow[] = useMemo(() => {
    // OMP completes a command name only while the first token is being typed.
    const nameToken = commandCompletionQuery(draft.text);
    if (nameToken === null) return [];
    return commandCompletions(nameToken).map((command) => ({
      command,
      insert: `/${command.name}${command.allowArgs ? ' ' : ''}`,
    }));
  }, [draft.text]);

  const active = rows.length === 0 ? 0 : Math.min(highlight, rows.length - 1);

  /** Hand the draft to the client along a route, and show the reason when it does not go. */
  const send = (route: PromptRoute) => {
    const outcome = client.submitPrompt(route);
    setNotice(outcome.ok ? null : (outcome.message ?? outcome.errorCode ?? 'Chưa gửi được.'));
  };

  /**
   * Type the draft into a herdr agent's pane. The draft clears only when the server confirms
   * the send and the text is still what was sent; a refusal keeps it for another try.
   */
  const sendToHerdr = (agent: HerdrAgent) => {
    if (herdrRequest !== null) return;
    const text = draft.text;
    const handle = sendPrompt(client, { kind: 'herdr', paneId: agent.paneId }, text);
    if (handle === null) return;
    if (!handle.ok) {
      setNotice(failureNotice(handle, 'Chưa gửi được.'));
      return;
    }
    setNotice(null);
    setHerdrRequest(handle.requestId);
    void client.waitForCommand(handle).then((verdict) => {
      setHerdrRequest((current) => (current === handle.requestId ? null : current));
      if (!verdict.ok) {
        setNotice(failureNotice(verdict, 'Chưa gửi được.'));
        return;
      }
      const current = client.getState().prompt.text;
      const remaining = draftAfterSend(current, text);
      if (remaining !== current) client.setDraftText(remaining);
    });
  };

  /** Type the draft into the cloud session in the drawer; the draft clears once its terminal took the text. */
  const sendToCloud = (target: NonNullable<PromptComposerProps['cloudTarget']>) => {
    if (draft.text.trim() === '') return;
    if (!target.send(draft.text)) {
      setNotice('Terminal cloud chưa nối xong hoặc đã đóng: đợi nó hiện rồi gửi lại.');
      return;
    }
    setNotice(null);
    client.setDraftText('');
  };

  /** Wake a sleeping session with the draft as its first prompt; the draft clears once the server accepts. */
  const wakeWithPrompt = (session: { readonly paneId: string }) => {
    if (herdrRequest !== null) return;
    const handle = wakeWithLine(client, session.paneId, draft.text);
    if (handle === null) return;
    if (!handle.ok) {
      setNotice(failureNotice(handle, 'Chưa đánh thức được.'));
      return;
    }
    setNotice(null);
    setHerdrRequest(handle.requestId);
    void client.waitForCommand(handle).then((verdict) => {
      setHerdrRequest((current) => (current === handle.requestId ? null : current));
      if (!verdict.ok) {
        setNotice(failureNotice(verdict, 'Chưa đánh thức được.'));
        return;
      }
      const current = client.getState().prompt.text;
      const remaining = draftAfterSend(current, draft.text);
      if (remaining !== current) client.setDraftText(remaining);
      // The woken session runs in the pane the server names: aim at it and let the drawer show it.
      if (verdict.paneId !== undefined) client.select({ herdrPaneId: verdict.paneId });
    });
  };

  /**
   * Hand the draft to the folder's team as a squad request. The draft clears only when the
   * server accepts the request; a refusal keeps the text for another try.
   */
  const sendSquad = () => {
    if (focus === null || blocker !== null || busy || squadRequest !== null) return;
    if (!squadTeam.ok) return;
    const text = draft.text;
    const handle = client.startSquad(focus, text);
    if (!handle.ok) {
      setNotice(failureNotice(handle, SQUAD_FALLBACK));
      return;
    }
    setNotice(null);
    setSquadRequest(handle.requestId);
    void client.waitForCommand(handle).then((verdict) => {
      setSquadRequest((current) => (current === handle.requestId ? null : current));
      if (!verdict.ok) {
        setNotice(failureNotice(verdict, SQUAD_FALLBACK));
        return;
      }
      const current = client.getState().prompt.text;
      const remaining = draftAfterSend(current, text);
      if (remaining !== current) client.setDraftText(remaining);
    });
  };

  /** Runs one entry of the send menu through the same path its shortcut takes. */
  const runSendEntry = (id: SendMenuEntryId) => {
    if (id === 'agent') setAssignOpen(true);
    else if (id === 'squad') sendSquad();
    else send(companyRoute(selectedSession));
  };

  /**
   * Type the draft into the selected session's terminal, followed by Enter. The draft
   * clears once the terminal takes the line; a refusal keeps it for another try.
   */
  const typeIntoSession = () => {
    if (selectedSession === null) {
      setNotice(NO_SESSION_NOTICE);
      return;
    }
    const data = terminalLine(draft.text);
    if (data === null) return;
    const outcome = client.writeTerminal(selectedSession.id, selectedSession.runEpoch, data);
    if (!outcome.ok) {
      setNotice(
        outcome.errorCode === 'terminal_not_attached'
          ? TERMINAL_NOT_OPEN_NOTICE
          : 'Chưa gõ được vào terminal của phiên.',
      );
      return;
    }
    setNotice(null);
    client.setDraftText('');
  };

  /**
   * `/new`, and the Phiên mới button's twin: a new omp chat in this folder, opened with no
   * prompt. The draft clears with the command. A refusal is shown here.
   */
  const openNewChat = () => {
    if (folderListLoading(state)) {
      setNotice(FOLDER_LIST_LOADING_MESSAGE);
      return;
    }
    setNotice(null);
    client.setDraftText('');
    void startNewChat(client).then((verdict) => {
      setNotice(failureNotice(verdict, 'Chưa mở được phiên mới.'));
    });
  };

  /**
   * `/resume`: ask the server for the omp sessions saved in this folder, and show
   * them in a picker. The answer is matched to this request by its requestId.
   */
  const openResumePicker = () => {
    const handle = client.requestOmpSessions();
    if (!handle.ok) {
      setNotice(handle.message ?? handle.errorCode ?? 'Chưa tải được danh sách phiên.');
      return;
    }
    client.setDraftText('');
    setNotice(null);
    setResumeRequest(handle.requestId);
  };

  /**
   * Resume the saved session the picker chose. The board selects it once it is on
   * the board; a refusal, at send or in the verdict, is shown here.
   */
  const resumeEntry = (entry: OmpSessionEntry) => {
    setResumeRequest(null);
    const handle = client.resumeSession(entry.file);
    if (!handle.ok) {
      setNotice(handle.message ?? handle.errorCode ?? 'Chưa mở được phiên.');
      return;
    }
    void client.waitForCommand(handle).then((verdict) => {
      if (!verdict.ok) setNotice(failureNotice(verdict, 'Chưa mở được phiên.'));
    });
  };

  /** Enter and the Send button: `/new` and `/resume` are the board's; every other line is typed. */
  const onSubmitKey = () => {
    const plan = planComposerCommand(draft.text);
    switch (plan.kind) {
      case 'new':
        openNewChat();
        return;
      case 'resume':
        openResumePicker();
        return;
      case 'prompt':
        if (cloudTarget !== undefined) sendToCloud(cloudTarget);
        else if (sleepingTarget !== null) wakeWithPrompt(sleepingTarget);
        else if (herdrTarget === null) typeIntoSession();
        else sendToHerdr(herdrTarget);
        return;
    }
  };

  // ── Voice and screen capture ──
  /** Counting down before the screen is taken, or the capture being marked up. */
  const [capture, setCapture] = useState<{ readonly left: number } | { readonly file: File } | null>(null);
  /** Send once the dictated text (and a marked capture) is in the draft. */
  const [sendAfterVoice, setSendAfterVoice] = useState<'now' | 'after-capture' | null>(null);
  const startCapture = () => {
    if (capture === null) setCapture({ left: CAPTURE_DELAY_SECONDS });
  };
  const voice = useVoiceInput(
    (spoken) => {
      const command = readVoiceCommands(spoken);
      const current = draft.text.trimEnd();
      if (command.text !== '') client.setDraftText(current === '' ? command.text : `${current} ${command.text}`);
      if (command.capture) startCapture();
      if (command.send) setSendAfterVoice(command.capture ? 'after-capture' : 'now');
      inputRef.current?.focus();
    },
    setNotice,
  );
  useEffect(() => {
    if (capture === null || !('left' in capture)) return undefined;
    if (capture.left > 0) {
      const timer = window.setTimeout(() => setCapture({ left: capture.left - 1 }), 1000);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    captureScreen()
      .then((file) => { if (!cancelled) setCapture({ file }); })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setCapture(null);
        setSendAfterVoice(null);
        setNotice(reason instanceof Error ? reason.message : 'Không chụp được màn hình.');
      });
    return () => { cancelled = true; };
  }, [capture]);
  // The newest send handler, so the effect below runs only when its own inputs change.
  const submitRef = useRef(onSubmitKey);
  submitRef.current = onSubmitKey;
  useEffect(() => {
    if (sendAfterVoice !== 'now' || busy) return;
    setSendAfterVoice(null);
    if (blocker === null) submitRef.current();
    else setNotice(blocker);
  }, [sendAfterVoice, busy, blocker]);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.code !== 'Space' || !event.ctrlKey || !event.shiftKey || event.altKey) return;
      event.preventDefault();
      // Holding the chord repeats the key: only the first press toggles.
      if (!event.repeat) voice.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const accept = (row: CompletionRow) => {
    setHighlight(0);
    setNotice(null);
    client.setDraftText(row.insert);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // While an IME is composing (Vietnamese Telex and similar), Enter only confirms a candidate.
    if (event.nativeEvent.isComposing) return;
    if (resumeRequest !== null && event.key === 'Escape') {
      event.preventDefault();
      setResumeRequest(null);
      return;
    }
    if (rows.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlight((current) => (current + 1) % rows.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlight((current) => (current - 1 + rows.length) % rows.length);
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        const row = rows[active];
        if (row !== undefined) accept(row);
        return;
      }
    }
    // Ctrl/Cmd+Alt+Enter hands the draft to the folder's team. It is checked before the
    // plain Enter below, which would otherwise send the line as a chat message.
    if (matchShortcut('composer.squad', event)) {
      event.preventDefault();
      sendSquad();
      return;
    }
    // Ctrl/Cmd+Shift+Enter hands the prompt to the Company workflow. It never
    // types into a terminal: the text is sent as the Company prompt.
    if (isCompanyChord(event)) {
      event.preventDefault();
      if (herdrTarget === null) send(companyRoute(selectedSession));
      else setNotice(HERDR_COMPANY_NOTICE);
      return;
    }
    // Enter, and Ctrl/Cmd+Enter, send the line. Shift+Enter starts a new line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmitKey();
    }
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setHighlight(0);
    setResumeRequest(null);
    setNotice(null);
    client.setDraftText(event.target.value);
  };

  const error = draft.error?.message ?? draft.error?.errorCode ?? null;

  // The handle on the box's top edge. Dragging up makes the box taller; the height is clamped
  // to the rows and to the text, and it is remembered when the drag ends.
  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const el = inputRef.current;
    if (el === null) return;
    const startPx = el.getBoundingClientRect().height;
    const metrics = measureBox(el);
    el.style.height = `${startPx}px`;
    resizeRef.current = { startY: event.clientY, startPx, metrics };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = resizeRef.current;
    const el = inputRef.current;
    if (drag === null || el === null) return;
    const { rowPx, chromePx, fitPx } = drag.metrics;
    const wantedPx = drag.startPx + (drag.startY - event.clientY);
    el.style.height = `${composerInputHeight(fitPx, rowPx, chromePx, wantedPx)}px`;
  }

  function endResize(): void {
    const el = inputRef.current;
    if (resizeRef.current === null || el === null) return;
    resizeRef.current = null;
    rememberHeight(el);
  }

  // Arrow keys move the handle one row at a time, so the box can be sized without a mouse.
  function nudgeResize(event: KeyboardEvent<HTMLDivElement>): void {
    const el = inputRef.current;
    const step = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    if (el === null || step === 0) return;
    event.preventDefault();
    const currentPx = el.getBoundingClientRect().height;
    const { rowPx, chromePx, fitPx } = measureBox(el);
    el.style.height = `${composerInputHeight(fitPx, rowPx, chromePx, currentPx + step * rowPx)}px`;
    rememberHeight(el);
  }

  /** Keep the box's current height as the floor it grows from, here and after a reload. */
  function rememberHeight(el: HTMLTextAreaElement): void {
    const px = Math.round(el.getBoundingClientRect().height);
    setSavedHeight(px);
    writeComposerHeight(composerStorage(), px);
  }

  return (
    <section
      className="bg-bg px-2 pt-1 pb-[max(4px,env(safe-area-inset-bottom))]"
      data-testid="prompt-composer"
    >
      {rows.length > 0 && (
        <ul
          className="mb-1 max-h-40 overflow-auto rounded-[var(--company-radius-md)] border border-hairline bg-raised"
          data-testid="prompt-completions"
        >
          {rows.map((row, index) => (
            <li key={row.insert}>
              <button
                type="button"
                onClick={() => accept(row)}
                className={`block w-full cursor-pointer px-2 py-1 text-left text-2xs ${
                  index === active ? 'company-selected text-text' : 'text-text-muted hover:bg-hover'
                }`}
              >
                <span className="text-text">/{row.command.name}</span>
                {row.command.inlineHint && <span> {row.command.inlineHint}</span>}
                <span> &mdash; {row.command.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {resumeView !== null && <OmpSessionPicker view={resumeView} onChoose={resumeEntry} />}

      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Kéo để đổi chiều cao ô nhập"
        tabIndex={0}
        title="Kéo để đổi chiều cao · Mũi tên lên hoặc xuống để chỉnh"
        data-testid="prompt-resize"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onKeyDown={nudgeResize}
        className="max-md:hidden flex h-1.5 cursor-row-resize touch-none items-center justify-center focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
      >
        <span aria-hidden="true" className="h-0.5 w-8 rounded-full bg-border" />
      </div>
      {images.previews.length > 0 && (
        <ul aria-label="Ảnh đính kèm" data-testid="prompt-image-previews" className="mb-1.5 flex flex-wrap gap-1.5">
          {images.previews.map((preview) => (
            <li key={preview.path} className="relative">
              <img
                src={preview.url}
                alt={preview.path}
                title={preview.path}
                className="h-16 w-16 rounded-[var(--company-radius-sm)] border border-hairline object-cover"
              />
              <button
                type="button"
                aria-label="Bỏ ảnh này"
                title="Bỏ ảnh này"
                onClick={() => client.setDraftText(withoutImagePath(draft.text, preview.path))}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-hairline bg-raised text-2xs text-text-muted hover:text-text"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* The tools and Send sit inside the box's bottom-right corner; the box keeps room for them below its text. */}
      <div className="relative">
        <textarea
          ref={inputRef}
          value={draft.text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
            const pasted = imageFiles(event.clipboardData.files);
            if (pasted.length === 0) return;
            event.preventDefault();
            images.attach(pasted);
          }}
          onDragOver={(event: DragEvent<HTMLTextAreaElement>) => {
            if ([...event.dataTransfer.items].some((item) => item.type.startsWith('image/'))) event.preventDefault();
          }}
          onDrop={(event: DragEvent<HTMLTextAreaElement>) => {
            const dropped = imageFiles(event.dataTransfer.files);
            if (dropped.length === 0) return;
            event.preventDefault();
            images.attach(dropped);
          }}
          rows={1}
          placeholder="Nhập tin nhắn · / để gõ lệnh · dán hoặc kéo ảnh vào đây"
          aria-label="Tin nhắn"
          data-testid="prompt-input"
          className="block w-full resize-none rounded-[var(--company-radius-md)] border border-border bg-raised px-3 pt-2 pb-10 text-sm leading-5 text-text"
        />
        <div className="absolute right-1.5 bottom-1.5 flex items-center gap-0.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          data-testid="prompt-image-input"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            images.attach(imageFiles(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Đính kèm ảnh"
          title="Đính kèm ảnh (hoặc dán Ctrl+V, kéo thả vào ô)"
          data-testid="prompt-attach-image"
          className="shrink-0 rounded-[var(--company-radius-sm)] px-1.5 py-1 text-sm text-text-muted hover:bg-hover hover:text-text"
        >
          {images.saving > 0 ? '…' : '📎'}
        </button>
        <button
          type="button"
          onClick={voice.toggle}
          disabled={voice.state === 'transcribing'}
          aria-pressed={voice.state === 'recording'}
          aria-label={voice.state === 'recording' ? 'Dừng nghe' : 'Nói (Ctrl+Shift+Space)'}
          title={voice.state === 'recording' ? 'Bấm lại để dừng và chép thành chữ' : 'Nói thay gõ (Ctrl+Shift+Space) · "chụp màn" để chụp · "gửi đi" để gửi'}
          data-testid="prompt-voice"
          className={`shrink-0 rounded-[var(--company-radius-sm)] px-1.5 py-1 text-sm hover:bg-hover ${voice.state === 'recording' ? 'text-status-error' : 'text-text-muted hover:text-text'}`}
        >
          {voice.state === 'recording' ? (
            <span className="flex items-center gap-1.5">
              ● {voice.seconds}s
              {/* Moves while the mic hears you: a flat bar means the wrong mic or a muted one. */}
              <span aria-hidden="true" className="h-2 w-8 overflow-hidden rounded-full bg-well">
                <span className="block h-full rounded-full bg-status-success transition-[width] duration-100" style={{ width: `${Math.round(voice.level * 100)}%` }} />
              </span>
            </span>
          ) : voice.state === 'transcribing' ? '…' : '🎤'}
        </button>
        {voice.mics.length > 0 && (
          <select
            aria-label="Chọn mic"
            title={`Mic đang dùng: ${voice.mics.find((mic) => mic.id === voice.micId)?.label ?? 'mic mặc định của trình duyệt'}. Bấm để đổi (tên mic hiện sau lần đầu cho trình duyệt dùng micro).`}
            value={voice.mics.some((mic) => mic.id === voice.micId) ? voice.micId : ''}
            onChange={(event) => voice.chooseMic(event.target.value)}
            data-testid="prompt-mic"
            className="w-5 shrink-0 cursor-pointer appearance-none rounded-[var(--company-radius-sm)] bg-transparent py-1 text-center text-xs text-text-muted hover:bg-hover hover:text-text"
          >
            <option value="" className="bg-raised text-text">▾ Mic mặc định của trình duyệt</option>
            {voice.mics.map((mic) => (
              <option key={mic.id} value={mic.id} className="bg-raised text-text">{mic.label}</option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={startCapture}
          disabled={capture !== null}
          aria-label="Chụp màn hình và đánh dấu"
          title={`Chụp cả màn hình sau ${CAPTURE_DELAY_SECONDS} giây (chuyển sang cửa sổ cần chụp), rồi khoanh, đánh số, che kín chỗ riêng tư trước khi gắn vào prompt`}
          data-testid="prompt-capture"
          className="shrink-0 rounded-[var(--company-radius-sm)] px-1.5 py-1 text-sm text-text-muted hover:bg-hover hover:text-text"
        >
          {capture !== null && 'left' in capture ? capture.left : '📸'}
        </button>
        <ComposerSendMenu
          sendLabel={images.saving > 0 ? 'Đang lưu ảnh...' : busy ? 'Đang gửi...' : 'Gửi'}
          sendDisabled={blocker !== null || busy || resumeRequest !== null || newSessionWaits}
          onSend={onSubmitKey}
          entries={sendMenu}
          onRun={runSendEntry}
        />
        </div>
      </div>
      <p className="mt-0.5 flex min-w-0 items-center gap-2 text-2xs text-text-muted">
        <span className="min-w-0 truncate" data-testid="prompt-target">
          {cloudTarget !== undefined ? `Gửi vào cloud: ${cloudTarget.label} · gõ ở đây (không trễ), Enter gửi cả đoạn` : sleepingTarget === null ? sendTargetLabel(selectedSession, herdrTarget) : sleepingTargetLabel(sleepingTarget)}
        </span>
        {pickerFolders.length > 0 && focus !== null && (
          <select
            aria-label="Thư mục nhận việc mới"
            title={`Thư mục nhận việc mới: ${folderLabelFor(state.workspaces, focus)}`}
            value={focus}
            onChange={(event) => pickFolder(event.target.value)}
            data-testid="prompt-folder"
            className="min-w-0 max-w-[160px] shrink cursor-pointer truncate rounded-(--company-radius-sm) bg-transparent px-1 text-2xs text-text-muted hover:bg-hover"
          >
            {pickerFolders.map((entry) => (
              <option key={entry.path} value={entry.path} className="bg-raised text-text">
                {entry.label}
              </option>
            ))}
          </select>
        )}
        <span className="min-w-0 truncate" title={modelLabel}>
          {modelLabel}
        </span>
        <span
          tabIndex={0}
          title={COMPOSER_HINTS}
          aria-label={COMPOSER_HINTS}
          className="ml-auto shrink-0 cursor-help rounded-full bg-raised px-1.5"
        >
          ?
        </span>
      </p>
      {notice !== null && (
        <p className="mt-1 text-2xs text-warning" data-testid="prompt-notice">
          {notice}
        </p>
      )}
      {newSessionWaits && (
        <p className="mt-1 text-2xs text-text-muted" data-testid="prompt-folder-loading">
          {FOLDER_LIST_LOADING_MESSAGE}
        </p>
      )}
      {error !== null && (
        <p className="mt-1 text-2xs text-warning" data-testid="prompt-error">
          {error}
        </p>
      )}
      {blocker !== null && draft.text.trim().length > 0 && (
        <p className="mt-1 text-2xs text-text-muted">{blocker}</p>
      )}
      {!squadTeam.ok && draft.text.trim().length > 0 && (
        <p className="mt-1 text-2xs text-text-muted" data-testid="prompt-squad-reason">
          {squadTeam.reason}
        </p>
      )}
      {assignOpen && focus !== null && (
        <CreateWorkDialog
          client={client}
          workspacePath={focus}
          title="Giao việc"
          initialText={draft.text}
          textEditable
          options={assigneeOptionsFor(state, focus)}
          folder={workItemsOf(state, focus)}
          onAccepted={() => {
            setAssignOpen(false);
            client.setDraftText('');
          }}
          onClose={() => setAssignOpen(false)}
        />
      )}
      {capture !== null && 'left' in capture && (
        <p role="status" className="mt-1 text-2xs text-text-muted" data-testid="prompt-capture-countdown">
          Chụp sau {capture.left} giây: chuyển sang cửa sổ cần chụp.
        </p>
      )}
      {capture !== null && 'file' in capture && (
        <ScreenAnnotateDialog
          image={capture.file}
          onCancel={() => {
            setCapture(null);
            setSendAfterVoice(null);
          }}
          onDone={(file) => {
            images.attach([file]);
            setCapture(null);
            setSendAfterVoice((current) => (current === 'after-capture' ? 'now' : current));
          }}
        />
      )}
    </section>
  );
}
