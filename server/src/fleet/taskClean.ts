/**
 * The shell the board runs on a cloud machine (`bash -s -- <slug>`, script on stdin) to remove a task `cloud-giao`
 * started: its tmux session, its worktrees, its local branch and its `~/.cloud-viec/<slug>.json` entry.
 *
 * It removes nothing when any worktree holds uncommitted files or commits no remote has: those would be lost.
 * The only path it ever removes comes from the ledger entry and must lie under the worktree base. The slug is
 * validated by the caller against FLEET_TASK_SLUG and is only ever read as "$1", never spliced into code.
 * With the second argument `push`, unpushed commits of a cloud/* branch are pushed to origin first, so cleaning loses nothing.
 * A task with no ledger entry and no tmux session is already gone: that is success, so the board can forget its row.
 * A tmux session cloud-giao did not create (started by hand) has no worktree of ours: only the session is closed, every file stays.
 * Exit codes: 3 a path it will not touch (or a session tmux would not close), 5 git refused, 7 unsaved work. The last line is the reason, or `OK <slug>`.
 */
export const TASK_CLEAN_SCRIPT = String.raw`set -u
slug="$1"
f="$HOME/.cloud-viec/$slug.json"
if [ ! -f "$f" ]; then
  if tmux has-session -t "=$slug" 2>/dev/null; then
    tmux kill-session -t "=$slug" 2>/dev/null || { echo "Khong tat duoc phien $slug"; exit 3; }
    echo "OK $slug (chi tat phien tmux, thu muc lam viec con nguyen)"; exit 0
  fi
  echo "OK $slug (khong con gi tren may)"; exit 0
fi
base="\${CLOUD_WT_BASE:-/data/home/wt}"
cwd=$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).cwd || ""))' "$f") || { echo "So viec bi hong"; exit 3; }
case "$cwd" in *..*|*[!A-Za-z0-9._:/-]*) echo "Duong dan viec khong hop le"; exit 3 ;; esac
case "$cwd" in "$base"/?*) ;; *) echo "Thu muc viec nam ngoai $base"; exit 3 ;; esac
trees=()
for w in "$cwd" "$cwd/backend" "$cwd/web" "$cwd/app"; do [ -e "$w/.git" ] && trees+=("$w"); done
for w in "\${trees[@]}"; do
  if git -C "$w" status --porcelain 2>/dev/null | grep -qv ' \.tsc-cache/\?$'; then echo "Con file chua commit trong $w"; exit 7; fi
done
# Unpushed commits: refuse, unless the caller asked to save them first (mode "push"): only a cloud/* branch is ever pushed.
for w in "\${trees[@]}"; do
  [ -z "$(git -C "$w" log --oneline -1 HEAD --not --remotes 2>/dev/null)" ] && continue
  [ "\${2:-}" = push ] || { echo "Con commit chua push trong $w"; exit 7; }
  branch="$(git -C "$w" rev-parse --abbrev-ref HEAD)"
  case "$branch" in cloud/*) ;; *) echo "Con commit chua push tren nhanh $branch (chi tu day nhanh cloud/*)"; exit 7 ;; esac
  git -C "$w" push -q -u origin "$branch" >/dev/null 2>&1 || { echo "Khong day duoc nhanh $branch len GitHub"; exit 7; }
  [ -z "$(git -C "$w" log --oneline -1 HEAD --not --remotes 2>/dev/null)" ] || { echo "Con commit chua push trong $w"; exit 7; }
done
tmux kill-session -t "=$slug" 2>/dev/null || true
for w in "\${trees[@]}"; do
  root="$(git -C "$w" rev-parse --path-format=absolute --git-common-dir)/.."
  branch="$(git -C "$w" rev-parse --abbrev-ref HEAD)"
  git -C "$root" worktree remove --force "$w" 2>/dev/null || { echo "Khong go duoc worktree $w"; exit 5; }
  case "$branch" in cloud/*) git -C "$root" branch -D "$branch" >/dev/null 2>&1 || true ;; esac
done
rm -f "$cwd/CLOUD-VIEC.md"; rmdir "$cwd" 2>/dev/null || true
# Claude Code keeps a trust entry in ~/.claude.json and a transcript folder per project path; both outlive the worktree.
# Only the exact paths of this task go (never a prefix: task "a" must not take task "a-b"). Best effort: the task itself is already removed.
HOME_DIR="$HOME" WT="$cwd" node -e '
const fs = require("fs"), wt = process.env.WT, home = process.env.HOME_DIR;
const mine = [wt, wt + "/backend", wt + "/web", wt + "/app"];
try {
  const p = home + "/.claude.json", c = JSON.parse(fs.readFileSync(p, "utf8"));
  const had = mine.filter((k) => c.projects && k in c.projects);
  if (had.length) { for (const k of had) delete c.projects[k]; fs.writeFileSync(p + ".tmp", JSON.stringify(c, null, 2), { mode: 0o600 }); fs.renameSync(p + ".tmp", p); }
} catch {}
for (const k of mine) {
  const name = k.replace(/[^A-Za-z0-9]/g, "-");
  if (name) { try { fs.rmSync(home + "/.claude/projects/" + name, { recursive: true, force: true }); } catch {} }
}' || true
rm -f "$f"
echo "OK $slug"
`.replace(/\\\$/g, '$');
