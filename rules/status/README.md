# Rule synchronization status

`latest.json` and `latest.md` describe the most recent successful rule
rebuild. They are committed only when the generated rule set changes.

Every GitHub Actions run uploads a diagnostic artifact, even when the run
fails:

- `rule-sync-log.json`: machine-readable status, source checks and error stack.
- `rule-sync-log.txt`: compact human-readable summary.
- `validation.log`: validation output when a rebuild was required.

Useful checks:

```bash
gh run list --workflow sync-rules.yml --limit 5
gh run view <run-id> --log-failed
gh run download <run-id> --name rule-sync-log-<run-id>
jq '{status,result,error,sources,providers}' \
  rule-sync-log-<run-id>/rule-sync-log.json
```

An unchanged scheduled run is expected to finish quickly with
`result: no_changes`. A stale successful rebuild is not itself an error; use the
Actions run history to confirm that scheduled checks are still executing.

For automated diagnosis, check `status` first, then `result`, then `error`.
Source entries include HTTP/ETag decisions and provider entries include Mihomo
and Shadowrocket output counts. The same artifact also reports Shadowrocket
GEOSITE generation, so an agent can distinguish an upstream failure from a
conversion or validation failure without parsing the console log.
