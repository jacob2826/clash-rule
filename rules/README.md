# Optimized rule pipeline

`mihomo_v2.yml` and `Shadowrocket.template.conf` are parallel, testable
configurations derived from `Mihomo.yml`. Shared policy names and user-visible
proxy groups come from the original file.

## Files

- `sources.json`: fixed allowlist of local and upstream rule sources.
- `generated/`: deterministic domain and ipcidr providers.
- `generated/shadowrocket/`: native classical rule lists for Shadowrocket.
- `Shadowrocket.template.conf`: node-free public routing template. A private
  delivery service replaces `__SUBSCRIPTION_NAME__` for each subscription.
- `state/upstreams.json`: conditional-check state, restored from the Action cache.
- `release-manifest.json`: content-addressed public delivery files and SHA-256 hashes.
- `status/latest.json`: machine-readable result of the latest content-changing rebuild.
- `status/latest.md`: compact human-readable rule and candidate difference report.
- `status/README.md`: Action health and diagnostic log instructions.

## Safety model

- Existing `Mihomo.yml` is never overwritten.
- Domain and CIDR rules are converted losslessly.
- Shadowrocket receives domain, CIDR, keyword and ASN rules. Process rules are
  intentionally omitted because iOS cannot apply desktop process matching.
- Every `GEOSITE` used by `Mihomo.yml` is synchronized from the matching
  MetaCubeX source and converted to a native Shadowrocket rule list.
- MetaCubeX candidates in `union` mode may add rules but cannot remove source rules.
- Candidates in `audit` mode are reported without changing output.
- Keyword, ASN and process rules are written directly into `mihomo_v2.yml`
  because domain/ipcidr providers cannot represent them without changing
  semantics. This avoids maintaining a provider for a handful of rules.
- Empty sources, HTML/error responses, unknown rule types, malformed YAML and
  files larger than 5 MiB fail the rebuild.
- The public Shadowrocket template contains no nodes, subscription URLs,
  tokens or credentials.
- Generated files, `mihomo_v2.yml` and `Shadowrocket.template.conf` are
  committed only after validation.

## Local verification

```bash
npm ci
npm run rules:sync
npm run rules:check
```

Every scheduled run creates downloadable JSON and text diagnostic logs, including
the full error stack on failure.

## Delivery releases

The existing workflow checks upstreams every six hours. Check timestamps and ETags
remain in the Action cache and diagnostic artifacts; unchanged deliverable content
does not create a commit or a release. The last content-change report stays intact.
Template, referenced rule or icon changes produce a new deterministic release ID.

Configure repository secrets `SUB_RELEASE_URL` and `SUB_RELEASE_SECRET` to publish
to a private delivery service. Neither value belongs in this repository. Publication
compares the active manifest and uploads only changed or missing files after validation
and commit. `release.log` in the existing diagnostic artifact reports the release ID,
upload count or failure without exposing the endpoint or credentials.

```bash
npm test
npm run release:build
```
