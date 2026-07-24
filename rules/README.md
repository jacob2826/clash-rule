# Optimized rule pipeline

`mihomo_v2.yml` is a parallel, testable configuration derived from
`Mihomo.yml`. Shared configuration and user-visible proxy groups come from the
original file. Only `rule-providers` and `rules` are rebuilt.

## Files

- `sources.json`: fixed allowlist of local and upstream rule sources.
- `generated/`: deterministic domain, ipcidr, residual and process providers.
- `state/upstreams.json`: GitHub ETag and content hash state for conditional checks.
- `status/latest.json`: machine-readable result of the latest successful rebuild.
- `status/latest.md`: compact human-readable rule and candidate difference report.
- `status/README.md`: Action health and diagnostic log instructions.

## Safety model

- Existing `Mihomo.yml` is never overwritten.
- Domain and CIDR rules are converted losslessly.
- MetaCubeX candidates in `union` mode may add rules but cannot remove source rules.
- Candidates in `audit` mode are reported without changing output.
- Keyword, ASN and process rules remain classical because domain/ipcidr providers
  cannot represent them without changing semantics.
- Empty sources, HTML/error responses, unknown rule types, malformed YAML and
  files larger than 5 MiB fail the rebuild.
- Generated files and `mihomo_v2.yml` are committed only after validation.

## Local verification

```bash
npm ci
npm run rules:sync
npm run rules:check
```

Every scheduled run creates downloadable JSON and text diagnostic logs, including
the full error stack on failure.
