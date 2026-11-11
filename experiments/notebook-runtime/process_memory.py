"""One observed process-tree RSS sample; not peak memory or physical allocation."""
import subprocess


def process_memory(root):
    rows = [tuple(map(int, line.split())) for line in subprocess.check_output(
        ['ps', '-axo', 'pid=,ppid=,rss='], text=True).splitlines()]
    owned = {root}
    while True:
        children = {pid for pid, parent, _rss in rows if parent in owned}
        if children <= owned:
            break
        owned |= children
    selected = [dict(pid=pid, parent=parent, rssKiB=rss) for pid, parent, rss in rows if pid in owned]
    return dict(scope='one ps RSS sample, root and descendants; shared pages may count twice',
                processes=selected, totalRssKiB=sum(row['rssKiB'] for row in selected))
