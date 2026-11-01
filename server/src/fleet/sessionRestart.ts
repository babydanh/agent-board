/**
 * The shell the board runs on a cloud machine (`bash -s -- <slug>`, script on stdin) to restart the Claude Code
 * of one tmux session on the SAME conversation: stop it, then `claude --resume <its session id>` in the same folder.
 * It is the fix for a session whose screen stays blank (a stuck full-screen redraw) without losing the conversation.
 *
 * It restarts nothing when Claude wrote to its transcript in the last 30 seconds (a turn may be running), when the
 * conversation file is gone (nothing to resume), or when Claude does not stop on SIGTERM (it is never killed harder).
 * The slug is validated by the caller against FLEET_TASK_SLUG and is only ever read as "$1", never spliced into code.
 * Exit codes: 3 Claude would not stop, 4 no such session or no Claude in it, 5 cannot resume, 6 busy.
 * The last line is the reason, or `OK <slug>`.
 */
export const SESSION_RESTART_SCRIPT = String.raw`set -u
slug="$1"
tmux has-session -t "=$slug" 2>/dev/null || { echo "Khong co phien $slug tren may"; exit 4; }
pane_pid="$(tmux list-panes -t "=$slug:" -F '#{pane_pid}' | head -1)"
find_claude() {
  for p in "$pane_pid" $(pgrep -P "$pane_pid" 2>/dev/null); do
    first="$(tr '\0' '\n' < "/proc/$p/cmdline" 2>/dev/null | head -1)"
    [ "\${first##*/}" = claude ] && { echo "$p"; return 0; }
  done
  return 1
}
pid="$(find_claude)" || { echo "Phien $slug khong chay Claude"; exit 4; }
uuid="$(tr '\0' '\n' < "/proc/$pid/cmdline" | awk 'f { print; exit } $0 == "--session-id" || $0 == "--resume" { f = 1 }')"
case "$uuid" in ????????-????-????-????-????????????) ;; *) echo "Khong doc duoc ma hoi thoai cua Claude"; exit 5 ;; esac
case "$uuid" in *[!0-9a-f-]*) echo "Ma hoi thoai khong hop le"; exit 5 ;; esac
cwd="$(readlink "/proc/$pid/cwd")"
case "$cwd" in ""|*[!A-Za-z0-9._/-]*) echo "Thu muc cua Claude khong hop le"; exit 5 ;; esac
transcript="$(ls -t "$HOME"/.claude/projects/*/"$uuid".jsonl 2>/dev/null | head -1)"
[ -n "$transcript" ] || { echo "Khong thay file hoi thoai de mo lai"; exit 5; }
[ $(( $(date +%s) - $(stat -c %Y "$transcript") )) -ge 30 ] || { echo "Claude vua ghi hoi thoai trong 30 giay, co the dang lam viec: doi xong roi thu lai"; exit 6; }
kill -TERM "$pid"
for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
kill -0 "$pid" 2>/dev/null && { echo "Claude khong chiu dung (da gui SIGTERM)"; exit 3; }
if tmux has-session -t "=$slug" 2>/dev/null; then
  tmux send-keys -t "=$slug:" "cd '$cwd' && claude --resume $uuid" Enter
else
  tmux new-session -d -s "$slug" -c "$cwd" "claude --resume $uuid"
  pane_pid="$(tmux list-panes -t "=$slug:" -F '#{pane_pid}' | head -1)"
fi
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  sleep 1
  npid="$(find_claude)" && [ "$npid" != "$pid" ] && { echo "OK $slug"; exit 0; }
done
echo "Da tat Claude nhung chua thay no mo lai trong 15 giay: xem phien $slug"
exit 5
`.replace(/\\\$/g, '$');
