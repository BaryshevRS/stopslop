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
includes clone locations.

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
