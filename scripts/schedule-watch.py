#!/usr/bin/env python3
import argparse
import json
import re
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

WORKFLOWS = Path(".github/workflows")
SELF = "schedule-watch.yml"
LABELS = ("type: bug", "scope: ci", "status: schedule-failure")
BOT = "app/github-actions"
# GitHub starts scheduled runs late under load; vivarium has seen 5.5 hours.
GRACE = timedelta(hours=12)
LOOKBACK = timedelta(days=32)
CRON = re.compile(r"""^\s*-\s*cron:\s*['"]([^'"]+)['"]""", re.MULTILINE)
FIELDS = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))


def field_values(field, low, high):
    values = set()
    for part in field.split(","):
        spec, _, step = part.partition("/")
        if spec == "*":
            start, end = low, high
        elif "-" in spec:
            start, end = map(int, spec.split("-"))
        else:
            start = int(spec)
            end = high if step else start
        values.update(range(start, end + 1, int(step or 1)))
    return values


def cron_matches(cron, t):
    fields = cron.split()
    minute, hour, dom, month, dow = (
        field_values(f, low, high) for f, (low, high) in zip(fields, FIELDS, strict=True)
    )
    if 7 in dow:
        dow.add(0)
    if t.minute not in minute or t.hour not in hour or t.month not in month:
        return False
    day = t.day in dom
    weekday = (t.isoweekday() % 7) in dow
    if fields[2] != "*" and fields[4] != "*":
        return day or weekday
    return day and weekday


def last_fire(crons, before):
    t = before.replace(second=0, microsecond=0)
    while before - t <= LOOKBACK:
        if any(cron_matches(c, t) for c in crons):
            return t
        t -= timedelta(minutes=1)
    return None


def scheduled_workflows(root=WORKFLOWS):
    found = {}
    for path in sorted(root.glob("*.yml")):
        crons = CRON.findall(path.read_text(encoding="utf-8"))
        if crons and path.name != SELF:
            found[path.name] = crons
    return found


def parse_time(text):
    return datetime.fromisoformat(text).astimezone(UTC)


def problem(file, crons, workflow, run, now):
    if workflow["state"] != "active":
        return f"- `{file}` is {workflow['state']}."
    due = last_fire(crons, now - GRACE)
    if run is None:
        if due is not None and parse_time(workflow["created_at"]) < due:
            return f"- `{file}` has never run on schedule."
        return None
    if run.get("conclusion") == "startup_failure":
        return f"- `{file}` failed to start: {run['html_url']}"
    if due is not None and parse_time(run["created_at"]) < due:
        return f"- `{file}` has not run on schedule since {run['created_at']}: {run['html_url']}"
    return None


def gh(*args):
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def check(repo, now, call=gh):
    lines = []
    for file, crons in scheduled_workflows().items():
        api = f"repos/{repo}/actions/workflows/{file}"
        workflow = json.loads(call("api", api))
        runs = json.loads(call("api", f"{api}/runs?event=schedule&per_page=1"))["workflow_runs"]
        line = problem(file, crons, workflow, runs[0] if runs else None, now)
        if line:
            lines.append(line)
    return lines


def report(repo, title, lines, run_url, call=gh):
    def issue(verb, *args):
        return call("issue", verb, *args, "--repo", repo)

    fields = "number,title,author"
    listed = json.loads(issue("list", "--state=open", f"--label={LABELS[-1]}", f"--json={fields}"))
    numbers = sorted(
        i["number"] for i in listed if i["title"] == title and i["author"]["login"] == BOT
    )
    if not lines:
        for number in numbers:
            issue(
                "close",
                str(number),
                "--reason=completed",
                f"--comment=Ran cleanly again: {run_url}",
            )
        return
    if not numbers:
        labels = [f"--label={label}" for label in LABELS]
        body = f"Found by {run_url}:\n\n" + "\n".join(lines) + "\n"
        issue("create", f"--title={title}", f"--body={body}", *labels)
        return
    for number in numbers:
        view = json.loads(issue("view", str(number), "--json=body,comments"))
        seen = {
            line
            for text in [view["body"], *(c["body"] for c in view["comments"])]
            for line in text.splitlines()
        }
        new = [line for line in lines if line not in seen]
        if new:
            body = f"Found by {run_url}:\n\n" + "\n".join(new) + "\n"
            issue("comment", str(number), f"--body={body}")


class FakeGh:
    def __init__(self, issues=(), views=None):
        self.issues = list(issues)
        self.views = views or {}
        self.calls = []

    def __call__(self, *args):
        self.calls.append(args)
        if args[:2] == ("issue", "list"):
            return json.dumps(self.issues)
        if args[:2] == ("issue", "view"):
            return json.dumps(self.views[int(args[2])])
        return ""

    def verbs(self):
        return [c[1] for c in self.calls if c[0] == "issue" and c[1] != "list"]


def self_test():
    t = datetime(2026, 10, 26, 18, 17, tzinfo=UTC)
    assert t.isoweekday() == 1
    assert last_fire(["30 1 * * *"], t) == datetime(2026, 10, 26, 1, 30, tzinfo=UTC)
    assert last_fire(["0 3 * * 1"], t) == datetime(2026, 10, 26, 3, 0, tzinfo=UTC)
    assert last_fire(["0 3 * * 1"], t - timedelta(hours=16)) == datetime(
        2026, 10, 19, 3, 0, tzinfo=UTC
    )
    assert last_fire(["0 3 * * 7"], t) == datetime(2026, 10, 25, 3, 0, tzinfo=UTC)
    assert last_fire(["*/20 9-17 * * 1-5"], t) == datetime(2026, 10, 26, 17, 40, tzinfo=UTC)
    assert last_fire(["0 0 1 * 0"], t) == datetime(2026, 10, 25, 0, 0, tzinfo=UTC)
    assert last_fire(["0 0 1 * *", "0 6 * * 0"], t) == datetime(2026, 10, 25, 6, 0, tzinfo=UTC)
    assert last_fire(["0 0 30 2 *"], t) is None

    daily = ["30 1 * * *"]
    active = {"state": "active", "created_at": "2026-01-01T00:00:00.000+09:00"}
    run = {"created_at": "2026-10-26T01:41:12Z", "conclusion": "success", "html_url": "u"}
    assert problem("a.yml", daily, active, run, t) is None
    late = dict(run, created_at="2026-10-25T01:31:00Z")
    assert problem("a.yml", daily, active, late, t).startswith("- `a.yml` has not run")
    assert problem("a.yml", daily, active, late, t - timedelta(hours=17)) is None
    running = dict(run, conclusion=None)
    assert problem("a.yml", daily, active, running, t) is None
    failed = dict(run, conclusion="failure")
    assert problem("a.yml", daily, active, failed, t) is None
    started = dict(run, conclusion="startup_failure")
    assert problem("a.yml", daily, active, started, t) == "- `a.yml` failed to start: u"
    disabled = dict(active, state="disabled_inactivity")
    assert problem("a.yml", daily, disabled, run, t) == "- `a.yml` is disabled_inactivity."
    assert problem("a.yml", daily, active, None, t) == "- `a.yml` has never run on schedule."
    new = dict(active, created_at="2026-10-26T02:00:00Z")
    assert problem("a.yml", daily, new, None, t) is None

    found = scheduled_workflows()
    assert SELF not in found and "upstream-bump.yml" in found, found
    for crons in found.values():
        assert last_fire(crons, t) is not None, crons

    title = "Scheduled workflows did not run"
    mine = {"number": 7, "title": title, "author": {"login": BOT}}
    other = {"number": 8, "title": title, "author": {"login": "someone"}}
    fake = FakeGh([other])
    report("o/r", title, ["- x"], "run", fake)
    assert fake.verbs() == ["create"], fake.calls
    assert "--label=status: schedule-failure" in fake.calls[-1]
    fake = FakeGh([mine], {7: {"body": "Found by r:\n\n- x\n", "comments": [{"body": "- y"}]}})
    report("o/r", title, ["- x", "- y"], "run", fake)
    assert fake.verbs() == ["view"], fake.calls
    report("o/r", title, ["- x", "- z"], "run", fake)
    assert fake.verbs() == ["view", "view", "comment"], fake.calls
    assert "--body=Found by run:\n\n- z\n" in fake.calls[-1]
    fake = FakeGh([mine, other])
    report("o/r", title, [], "run", fake)
    assert fake.verbs() == ["close"] and fake.calls[-1][2] == "7", fake.calls
    print(f"schedule-watch ready: {len(found)} scheduled workflows found")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    sub = parser.add_subparsers(dest="command")
    watch = sub.add_parser("check", help="print one line per scheduled workflow that did not run")
    watch.add_argument("--repo", required=True)
    issue = sub.add_parser("report", help="open, comment on or close the Issue for stdin's lines")
    issue.add_argument("--repo", required=True)
    issue.add_argument("--title", required=True)
    issue.add_argument("--run-url", required=True)
    args = parser.parse_args()
    if args.self_test:
        self_test()
    elif args.command == "check":
        for line in check(args.repo, datetime.now(UTC)):
            print(line)
    elif args.command == "report":
        lines = [line for line in sys.stdin.read().splitlines() if line.strip()]
        report(args.repo, args.title, lines, args.run_url)
    else:
        parser.error("choose --self-test, check or report")


if __name__ == "__main__":
    main()
