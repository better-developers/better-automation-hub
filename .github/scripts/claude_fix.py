#!/usr/bin/env python3
"""
claude_fix.py — reads Coolify deployment logs from /tmp/deploy_logs.txt,
asks Claude to diagnose and fix the failure, applies the patch to the
working tree, and writes a summary to /tmp/claude_analysis.txt.
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import anthropic


def get_repo_files(extensions=(".ts", ".tsx", ".js", ".json", ".toml", ".env.example")) -> dict[str, str]:
    """Return a {relative_path: content} mapping for relevant repo files."""
    files: dict[str, str] = {}
    root = Path(".")
    skip_dirs = {".git", "node_modules", ".next", "dist", "build", ".turbo"}

    for ext in extensions:
        for path in root.rglob(f"*{ext}"):
            if any(part in skip_dirs for part in path.parts):
                continue
            try:
                files[str(path)] = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                pass

    return files


def build_prompt(logs: str, repo_files: dict[str, str]) -> str:
    files_section = "\n\n".join(
        f"### {path}\n```\n{content[:4000]}\n```"
        for path, content in list(repo_files.items())[:40]
    )

    return f"""You are an expert TypeScript / Next.js developer.

A Coolify preview deployment just failed. Your job is to:
1. Identify the root cause from the build/deploy logs.
2. Produce the minimal file edits required to fix it.
3. Return your response as **valid JSON only** — no markdown fences, no prose outside JSON.

## Response schema
{{
  "analysis": "<one-paragraph explanation of the root cause>",
  "fixes": [
    {{
      "path": "<relative file path from repo root>",
      "old": "<exact string to replace — must match the file content exactly>",
      "new": "<replacement string>"
    }}
  ]
}}

If no code change can fix the problem (e.g. missing secret), set `fixes` to `[]` and explain in `analysis`.

## Deployment logs (last 12 000 chars)
```
{logs}
```

## Repository files
{files_section}
"""


def apply_fixes(fixes: list[dict]) -> list[str]:
    applied: list[str] = []
    for fix in fixes:
        path = Path(fix["path"])
        if not path.exists():
            print(f"  [skip] {path} — file not found", file=sys.stderr)
            continue

        content = path.read_text(encoding="utf-8")
        old = fix["old"]
        new = fix["new"]

        if old not in content:
            print(f"  [skip] {path} — old string not found", file=sys.stderr)
            continue

        path.write_text(content.replace(old, new, 1), encoding="utf-8")
        applied.append(str(path))
        print(f"  [fixed] {path}", file=sys.stderr)

    return applied


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pr", required=True)
    parser.add_argument("--branch", required=True)
    args = parser.parse_args()

    logs_path = Path("/tmp/deploy_logs.txt")
    if not logs_path.exists():
        print("No deploy logs found at /tmp/deploy_logs.txt", file=sys.stderr)
        sys.exit(1)

    logs = logs_path.read_text(encoding="utf-8", errors="replace")
    repo_files = get_repo_files()

    client = anthropic.Anthropic(auth_token=os.environ["CLAUDE_CODE_OAUTH_TOKEN"])

    print("Calling Claude to analyse failure...", file=sys.stderr)
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[{"role": "user", "content": build_prompt(logs, repo_files)}],
    )

    raw = message.content[0].text.strip()

    # Strip accidental markdown code fences
    if raw.startswith("```"):
        raw = "\n".join(raw.split("\n")[1:])
    if raw.endswith("```"):
        raw = "\n".join(raw.split("\n")[:-1])

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"Claude returned non-JSON: {exc}\n{raw[:500]}", file=sys.stderr)
        Path("/tmp/claude_analysis.txt").write_text(
            "Claude returned an unparseable response — no fixes applied.\n\n" + raw[:2000]
        )
        sys.exit(0)

    analysis: str = result.get("analysis", "")
    fixes: list[dict] = result.get("fixes", [])

    print(f"Analysis: {analysis}", file=sys.stderr)
    print(f"Fixes proposed: {len(fixes)}", file=sys.stderr)

    applied = apply_fixes(fixes)

    summary_lines = [
        f"**Root cause:** {analysis}",
        "",
        f"**Files patched ({len(applied)}):**",
    ]
    for p in applied:
        summary_lines.append(f"- `{p}`")
    if not applied:
        summary_lines.append("_No file changes were applied._")

    Path("/tmp/claude_analysis.txt").write_text("\n".join(summary_lines))
    print("Done.", file=sys.stderr)


if __name__ == "__main__":
    main()
