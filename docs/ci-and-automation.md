# CI and automation

StopSlop has three stable exit codes: `0` means the gate is clear, `1` means
findings were detected, and `2` means analysis or configuration failed. Pin the
package version in `devDependencies` so local runs and CI use the same rules.

## Reject new findings with a committed baseline

Create the baseline once and review it like source code:

```bash
npx stopslop . \
  --baseline .stopslop-baseline.json \
  --update-baseline
git add .stopslop-baseline.json
```

Then use the same file in CI:

```yaml
- name: Reject new AI slop
  run: npx stopslop . --baseline .stopslop-baseline.json
```

The baseline suppresses accepted findings from the gate. It never removes them
from the full-repository score.

## Compare a pull request with its Git base

This mode needs the base revision to exist locally:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0

- name: Reject AI slop added by this change
  run: npx stopslop . --base origin/main
```

`--base` and `--baseline` are alternative gates. Do not pass them together.

## Publish SARIF without hiding the gate failure

The scan may exit `1` after writing valid SARIF. Let the upload step run, then
propagate the original result. The workflow or job needs permission to publish
code-scanning results:

```yaml
permissions:
  contents: read
  security-events: write
```

Then add the scan, upload, and enforcement steps:

```yaml
- name: Scan with StopSlop
  id: stopslop
  continue-on-error: true
  run: npx stopslop . --base origin/main --format sarif > stopslop.sarif

- name: Upload StopSlop SARIF
  if: always() && hashFiles('stopslop.sarif') != ''
  uses: github/codeql-action/upload-sarif@v4
  with:
    sarif_file: stopslop.sarif

- name: Enforce StopSlop gate
  if: steps.stopslop.outcome == 'failure'
  run: exit 1
```

An exit code of `2` does not emit a report, preventing an incomplete analysis
from being published as a trustworthy result.

## Give structured findings to a coding agent

```bash
npx stopslop . --format json > slop-report.json
```

The JSON schema version is included in the document. Findings carry stable
`kind`, `file`, `symbol`, `line`, `message`, and optional structured `data`
fields. God-unit data includes responsibility groups; duplicate-code data
includes clone locations. `rules` holds, for each reported kind, its `summary`,
`why`, `fix`, the `config` setting that tunes it, and a `helpUri` into
[rules.md](rules.md), so the agent does not have to guess what a rule wants.

## Run the check inside the agent session

The repository is a plugin for Claude Code, Codex, and Cursor and an extension
for Gemini CLI; the [README](../README.md#catch-slop-while-the-agent-is-still-working)
lists the install command for each. All of them get the `stopslop` skill. The
stop hook, `hooks/stop-gate.mjs`, runs when the agent is about to end a turn. It
asks Git whether any JS/TS source or `package.json` changed, and if something
did, it runs

```bash
npx stopslop . --baseline .stopslop-baseline.json --format json  # when the file exists
npx stopslop . --base HEAD --format json                         # otherwise
```

and hands the new findings back to the agent with each kind's fix, which the
agent receives as its next instruction. It does not block on analysis errors,
and it nudges once per turn, so a finding you decide to keep cannot loop the
session. It runs the project's own `node_modules/stopslop` when installed,
otherwise `npx stopslop@1`.

| Agent | Hook event | Hook answer |
| --- | --- | --- |
| Claude Code, Codex | `Stop` | `decision: "block"` with the findings as `reason` |
| Gemini CLI | `AfterAgent` | the same |
| Cursor | `stop` (`--agent cursor`) | `followup_message` |

Codex runs plugin hooks only after you trust them; it asks at the start of the
first session after install.

## Commit the hook to the project

`hooks/stop-gate.mjs` ships in the npm package. A project that pins `stopslop`
in `devDependencies` can commit the hook to its agent settings, so every
contributor gets it without installing a plugin. This is also the way to the
hook for Gemini CLI: an extension reads hooks only from `hooks/hooks.json`,
which in this repository holds the Claude Code and Codex hook.

Gemini CLI, `.gemini/settings.json`:

```json
{
  "hooks": {
    "AfterAgent": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$GEMINI_PROJECT_DIR/node_modules/stopslop/hooks/stop-gate.mjs\"",
            "timeout": 300000
          }
        ]
      }
    ]
  }
}
```

Claude Code, `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/node_modules/stopslop/hooks/stop-gate.mjs\"",
            "timeout": 300
          }
        ]
      }
    ]
  }
}
```

Codex, `.codex/hooks.json`; Codex runs the hook in the session's working
directory:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node node_modules/stopslop/hooks/stop-gate.mjs",
            "timeout": 300
          }
        ]
      }
    ]
  }
}
```

Cursor, `.cursor/hooks.json`; project hooks run from the project root:

```json
{
  "version": 1,
  "hooks": {
    "stop": [{ "command": "node node_modules/stopslop/hooks/stop-gate.mjs --agent cursor" }]
  }
}
```

Agents without a plugin system or hooks get the skill alone with
`npx skills add BaryshevRS/stopslop`.

## Generate a binary Shields badge

Use the same baseline as CI:

```bash
npx stopslop . \
  --baseline .stopslop-baseline.json \
  --format shields > stopslop-badge.json
```

The badge says `AI slop | clear` when the gate has no unaccepted findings and
`AI slop | detected` otherwise. Accepted legacy remains visible in the terminal
and JSON score.
