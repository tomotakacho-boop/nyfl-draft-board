#!/usr/bin/env python3
"""Install/update a weekly macOS launchd job for the iMessage extractor."""

import argparse
import json
import os
import plistlib
import subprocess
import sys
from pathlib import Path


LABEL = "com.nyfl.group-chat-archive"


def expand(value):
    return Path(os.path.expandvars(os.path.expanduser(str(value)))).resolve()


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--weekday", type=int, default=0, choices=range(0, 7), metavar="0-6")
    parser.add_argument("--hour", type=int, default=9, choices=range(0, 24), metavar="0-23")
    parser.add_argument("--minute", type=int, default=0, choices=range(0, 60), metavar="0-59")
    parser.add_argument("--publish", action="store_true", help="Also prepare reviewed website files each week")
    return parser.parse_args()


def main():
    args = parse_args()
    config_path = expand(args.config)
    if not config_path.exists():
        raise RuntimeError(f"Config not found: {config_path}")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    archive = expand(config.get("privateArchive", "~/Documents/NYFL Group Chat Archive"))
    archive.mkdir(parents=True, exist_ok=True)
    extractor = Path(__file__).resolve().with_name("imessage_group_chat_export.py")
    python = Path(sys.executable).resolve()
    arguments = [str(python), str(extractor), "--config", str(config_path)]
    if args.publish:
        arguments.append("--publish")

    payload = {
        "Label": LABEL,
        "ProgramArguments": arguments,
        "WorkingDirectory": str(extractor.parents[1]),
        "StartCalendarInterval": {
            "Weekday": args.weekday,
            "Hour": args.hour,
            "Minute": args.minute,
        },
        "RunAtLoad": False,
        "StandardOutPath": str(archive / "weekly-export.log"),
        "StandardErrorPath": str(archive / "weekly-export-error.log"),
        "ProcessType": "Background",
    }
    agents = expand("~/Library/LaunchAgents")
    agents.mkdir(parents=True, exist_ok=True)
    destination = agents / f"{LABEL}.plist"
    destination.write_bytes(plistlib.dumps(payload, fmt=plistlib.FMT_XML, sort_keys=False))

    domain = f"gui/{os.getuid()}"
    subprocess.run(["/bin/launchctl", "bootout", domain, str(destination)], capture_output=True)
    loaded = subprocess.run(["/bin/launchctl", "bootstrap", domain, str(destination)], capture_output=True, text=True)
    if loaded.returncode != 0:
        raise RuntimeError(loaded.stderr.strip() or "launchctl bootstrap failed")
    print(f"Installed {destination}")
    print(f"Schedule: weekday {args.weekday}, {args.hour:02d}:{args.minute:02d} local time")
    print(f"Mode: {'private extraction + website preparation' if args.publish else 'private extraction only'}")
    print(f"Test: launchctl kickstart -k {domain}/{LABEL}")
    print(f"Logs: {archive}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
