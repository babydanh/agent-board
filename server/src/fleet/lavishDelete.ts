/**
 * The shell the board runs on a cloud machine (`bash -s -- <key>`, script on stdin) to delete one Lavish page:
 * it ends the session in Lavish and removes the HTML file, so the agent that wrote it can simply write it again.
 *
 * The file is never taken from the caller: only the 8-64 hex key is passed (validated against FLEET_LAVISH_KEY and
 * read as "$1", never spliced into code), and the page is looked up in the machine's own Lavish state. It must
 * live in a `.lavish/` directory and contain no `..`, so no other file can be removed through this.
 * A key Lavish no longer knows is already gone: that is success, so the board can forget its row.
 * Exit codes: 3 a path it will not touch or a file it could not remove. The last line is the reason, or `OK <key>`.
 */
export const LAVISH_DELETE_SCRIPT = String.raw`set -u
key="$1"
state="$HOME/.lavish-axi/state.json"
if [ ! -f "$state" ]; then echo "OK $key (may khong co Lavish)"; exit 0; fi
file=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const e=(s.sessions||{})[process.argv[2]];process.stdout.write(e&&typeof e.file==="string"?e.file:"")' "$state" "$key") || { echo "So Lavish bi hong"; exit 3; }
if [ -z "$file" ]; then echo "OK $key (khong con trong Lavish)"; exit 0; fi
case "$file" in *..*|*[!A-Za-z0-9._:/-]*) echo "Duong dan Lavish khong hop le"; exit 3 ;; esac
case "$file" in */.lavish/*.html) ;; *) echo "Tu choi: trang Lavish phai nam trong thu muc .lavish"; exit 3 ;; esac
timeout 20 lavish-axi end "$file" >/dev/null 2>&1 || true
rm -f -- "$file" || { echo "Khong xoa duoc trang Lavish"; exit 3; }
echo "OK $key $file"
`;
