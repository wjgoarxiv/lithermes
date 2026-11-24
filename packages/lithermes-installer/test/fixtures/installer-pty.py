"""Runs one command on a pseudo-terminal, under a shell as a person would, and types at it.

stdin: JSON {"rows", "cols", "steps": [[wait-for-text, keys], ...]}. A step is typed once its text has
been printed anywhere after the text the previous step waited for, however the reads were split. stdout: JSON {"output", "status", "typed", "cooked"}; "status" is the shell's
$? (130 for SIGINT), "cooked" says whether the terminal was left in its normal mode.
"""
import fcntl, json, os, pty, re, select, struct, subprocess, sys, termios, time

spec = json.load(sys.stdin)
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", spec["rows"], spec["cols"], 0, 0))


def own_terminal():
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)


SHELL = """trap : INT; "$@"; status=$?
case "$(stty -a)" in *-icanon*) echo LEFT_RAW;; esac
exit $status"""
child = subprocess.Popen(["sh", "-c", SHELL, "sh", *sys.argv[1:]], stdin=slave, stdout=slave, stderr=slave, preexec_fn=own_terminal)
data, seen, typed, deadline = b"", 0, 0, time.time() + 90
while time.time() < deadline:
    ready = select.select([master], [], [], 0.05)[0]
    if ready:
        try:
            chunk = os.read(master, 65536)
        except OSError:
            break
        if not chunk:
            break
        data += chunk
    elif child.poll() is not None:
        break
    if typed < len(spec["steps"]):
        text, keys = spec["steps"][typed]
        # A gradient puts an escape between letters, so the wait is for the text without them.
        plain = re.sub(rb"\x1b\[[0-9;?]*[A-Za-z]", b"", data)
        at = plain.find(text.encode(), seen)
        if at >= 0:
            seen = at + len(text.encode())
            os.write(master, keys.encode())
            typed += 1
if child.poll() is None and time.time() >= deadline:
    child.kill()
status = child.wait()
json.dump({"output": data.decode(errors="replace"), "status": status, "typed": typed, "cooked": b"LEFT_RAW" not in data}, sys.stdout)
