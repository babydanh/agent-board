import { FLEET_PROMPT_COUNT, FLEET_PROMPT_MAX_CHARS } from './constants.js';

/**
 * Reading a cloud session's last prompts. A Claude session on a cloud machine keeps its transcript under
 * ~/.claude/projects/<working directory with every non-alphanumeric character as "-">/; the board has no other channel
 * for what the user asked it, so one remote script reads the newest transcript of each tmux session.
 */

export const PANE_PROMPTS_MARKER = '@@BOARD-PROMPTS@@';

// No backslash anywhere: the script passes through a TS string, bash and python, so line splitting uses splitlines().
const PYTHON_READER = [
  'import sys, os, re, json, glob',
  "cwd = sys.argv[1] if len(sys.argv) > 1 else ''",
  "base = os.path.expanduser('~/.claude/projects/') + re.sub(r'[^A-Za-z0-9]', '-', cwd)",
  "files = sorted(glob.glob(base + '/*.jsonl'), key=os.path.getmtime, reverse=True)[:1]",
  'out = []',
  'for path in files:',
  "    with open(path, 'rb') as f:",
  '        f.seek(0, 2)',
  '        size = f.tell()',
  '        f.seek(max(0, size - 400000))',
  "        lines = f.read().decode('utf-8', 'replace').splitlines()",
  '    for line in reversed(lines):',
  '        try:',
  '            rec = json.loads(line)',
  '        except Exception:',
  '            continue',
  "        if rec.get('type') != 'user' or rec.get('isSidechain') or rec.get('isMeta'):",
  '            continue',
  "        c = (rec.get('message') or {}).get('content')",
  '        if isinstance(c, list):',
  "            c = ' '.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text')",
  '        if not isinstance(c, str):',
  '            continue',
  "        c = ' '.join(c.split())",
  "        if not c or c.startswith('<'):",
  '            continue',
  `        out.append(c[:${FLEET_PROMPT_MAX_CHARS}])`,
  `        if len(out) == ${FLEET_PROMPT_COUNT}:`,
  '            break',
  'for t in out:',
  "    print('P ' + json.dumps(t, ensure_ascii=False))",
].join('\n');

/** One remote bash script: for every tmux session, a marker line then its newest prompts (newest first) as `P "<json string>"`. Names never reach it. */
export const PANE_PROMPTS_SCRIPT = [
  "tmux list-sessions -F '#{session_name}' 2>/dev/null | while IFS= read -r s; do",
  `  echo "${PANE_PROMPTS_MARKER} $s"`,
  '  d=$(tmux display-message -p -t "=$s:" \'#{pane_current_path}\' 2>/dev/null)',
  '  python3 - "$d" 2>/dev/null <<\'PY\'',
  PYTHON_READER,
  'PY',
  'done',
  '',
].join('\n');

/** The prompts of a script dump, by tmux session. Anything that is not a prompt line under a marker is ignored. */
export function parsePanePrompts(dump: string): Map<string, string[]> {
  const bySession = new Map<string, string[]>();
  let session: string | null = null;
  for (const line of dump.split('\n')) {
    if (line.startsWith(`${PANE_PROMPTS_MARKER} `)) {
      session = line.slice(PANE_PROMPTS_MARKER.length + 1).trim();
    } else if (session !== null && line.startsWith('P ')) {
      const text = promptOf(line.slice(2));
      const list = bySession.get(session) ?? [];
      if (text !== null && list.length < FLEET_PROMPT_COUNT) bySession.set(session, [...list, text]);
    }
  }
  return bySession;
}

function promptOf(json: string): string | null {
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value !== 'string' || value.trim() === '') return null;
    return value.slice(0, FLEET_PROMPT_MAX_CHARS);
  } catch {
    return null;
  }
}
