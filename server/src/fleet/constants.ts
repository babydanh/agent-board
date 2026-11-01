export const FLEET_CONFIG_PATH_SEGMENTS = ['.pixel-agents', 'fleet.json'] as const;
export const FLEET_FETCH_TIMEOUT_MS = 10_000;
export const FLEET_CACHE_MS = 15_000;
export const FLEET_STALE_AFTER_MS = 10 * 60_000;

export const FLEET_REASON_READ_ONLY = 'Kết nối chỉ đọc không được phép xem Cloud.';
export const FLEET_REASON_UNAVAILABLE = 'Cloud chưa được cấu hình hoặc hiện không khả dụng.';
export const FLEET_REASON_COMMAND_FAILED = 'Không thể tải dữ liệu Cloud từ hub.';
export const FLEET_REASON_HUB_FALLBACK =
  'Hub đang nghỉ, nên chỉ hiện phiên tmux của máy đang chạy (chưa có nhánh, repo); máy đang ngủ chưa hiện.';

/** Same patterns as the AsyncAPI schema; checked again server-side before anything reaches a command line. */
export const FLEET_MACHINE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const FLEET_SESSION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const FLEET_TASK_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const FLEET_TASK_REPOS = ['backend', 'web', 'app', 'all'] as const;
/** The agent a cloud task starts; claude is the default and keeps the old cloud-giao argv. */
export const FLEET_TASK_ENGINES = ['claude', 'omp'] as const;
export const FLEET_PROMPT_MAX = 20_000;
/** Board-side PTY ids for cloud terminals: far above local agent ids so the two never collide. */
export const FLEET_TERMINAL_ID_BASE = 900_000_000;
/** Which InstaBox account owns which machine, re-read at most this often. */
export const FLEET_ACCOUNT_CACHE_MS = 10 * 60_000;
export const FLEET_INSTABOX_TIMEOUT_MS = 120_000;

export const FLEET_REASON_BAD_INPUT = 'Tên máy, tên phiên hoặc nội dung việc không hợp lệ.';
export const FLEET_REASON_NO_TERMINAL = 'Board không có terminal (chạy với --no-terminal hoặc thiếu node-pty).';
export const FLEET_REASON_NO_MACHINE = 'Không tìm thấy máy này trong các tài khoản InstaBox đã đăng nhập.';

/** lavish-axi on every cloud machine listens on this loopback port (LAVISH_AXI_PORT in the cloud bundle). */
export const FLEET_LAVISH_REMOTE_PORT = 4800;
export const FLEET_LAVISH_KEY = /^[a-f0-9]{8,64}$/;
/** How long to wait for `instabox port-forward` to accept connections (the machine may be waking). */
export const FLEET_FORWARD_READY_MS = 120_000;
/** A forward nobody re-opened for this long is closed; opening Lavish again re-creates it. */
export const FLEET_FORWARD_IDLE_MS = 30 * 60_000;
/** Only repositories under the cloud home, plain path characters (the path reaches a remote shell, single-quoted). */
export const FLEET_REPO_PATH = /^\/data\/home\/(?!.*\.\.)[A-Za-z0-9._/-]{1,250}$/;
export const FLEET_DIFF_MAX_BYTES = 300_000;
/** Untracked (new) files shown with their content in a diff: at most this many, each cut at this many bytes. */
export const FLEET_DIFF_NEW_FILES = 20;
export const FLEET_DIFF_NEW_FILE_BYTES = 20_000;
/** The board's own scrollback for one cloud tmux session: how many lines are read, and the most bytes sent (the newest are kept). */
export const FLEET_HISTORY_LINES = 50_000;
export const FLEET_HISTORY_MAX_BYTES = 1_500_000;
export const FLEET_REASON_NOT_REPORTED = 'Máy này chưa báo repository đó cho hub (đợi 30 giây rồi thử lại).';
/** A tmux pane peek: one marker line per session in the dump, and how many bottom lines of each pane are read. */
export const FLEET_PEEK_MARKER = '@@BOARD-PEEK@@';
export const FLEET_PEEK_TAIL_LINES = 25;
/** Lines taken from each pane's screen before blank rows are dropped (a tall empty pane keeps its text at the top). */
export const FLEET_PEEK_DUMP_LINES = 60;
/** A cloud session idle for less than this is at work, never waiting for an answer: it is not peeked. */
export const FLEET_ASK_MIN_IDLE_S = 20;
/** How long a machine's peek answer is reused before the next snapshot starts a fresh one (never awaited by the snapshot). */
export const FLEET_ASK_CACHE_MS = 45_000;
/** The peek runs on the machine and must not hang a snapshot's follow-up: seconds, passed to `instabox exec --timeout`. */
export const FLEET_ASK_PEEK_TIMEOUT_S = 20;
/** A cloud session's last prompts: how many the board shows, how long each one may be, and how long a machine's answer is reused. */
export const FLEET_PROMPT_COUNT = 5;
export const FLEET_PROMPT_MAX_CHARS = 300;
export const FLEET_PROMPT_CACHE_MS = 60_000;
/** Reading the transcripts runs on the machine: seconds, passed to `instabox exec --timeout`. */
export const FLEET_PROMPT_PEEK_TIMEOUT_S = 25;
/** The hub keeps at most this many task entries per machine (fleet/hub.mjs); a list this long may have been cut. */
export const FLEET_HUB_TASK_LIMIT = 30;
