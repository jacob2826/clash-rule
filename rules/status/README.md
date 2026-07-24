# Rule synchronization status

`latest.json` and `latest.md` describe the most recent successful rule
rebuild. They are committed only when the generated rule set changes.

Every GitHub Actions run uploads two artifacts, even when the run fails:

- `rule-sync-log.json`: machine-readable status, source checks and error stack.
- `rule-sync-log.txt`: compact human-readable summary.

Useful checks:

```bash
gh run list --workflow sync-rules.yml --limit 5
gh run view --log-failed
gh run download --name rule-sync-log-<run-id>
```

An unchanged scheduled run is expected to finish quickly with
`result: no_changes`. A stale successful rebuild is not itself an error; use the
Actions run history to confirm that scheduled checks are still executing.
