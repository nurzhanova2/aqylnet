# certs/

`infowatch-proxy-root.crt` — the root certificate of the TLS-intercepting proxy
on this corporate network (`CN=InfoWatch Transparent Proxy Root, O=ZAO InfoWatch`,
self-signed, valid to 2076-01-10, SHA-1 thumbprint
`6C55824028B0AB64F2B4F140900F2D79762AD744`).

Outbound TLS to hosts such as `prod-litellm.nationalbank.kz` arrives re-signed by
this root, so without it the leaf fails verification with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`. The `Dockerfile` installs it into the system
bundle and points `NODE_EXTRA_CA_CERTS` at it; that keeps verification on. It
replaced `ENV NODE_TLS_REJECT_UNAUTHORIZED=0`, which disabled verification for
every outbound call including the one carrying `LLM_API_KEY`.

This is a public certificate, not a secret — it is presented to every TLS client
on the network.

To refresh it when the proxy root is rotated (PowerShell on a domain-joined host):

```powershell
$c = Get-ChildItem Cert:\LocalMachine\Root |
     Where-Object { $_.Subject -like '*InfoWatch*' } | Select-Object -First 1
$b64 = [Convert]::ToBase64String($c.RawData, 'InsertLineBreaks')
"-----BEGIN CERTIFICATE-----`n$b64`n-----END CERTIFICATE-----" |
  Set-Content backend/certs/infowatch-proxy-root.crt -Encoding ascii
```

Check it against the live endpoint before rebuilding:

```bash
openssl s_client -connect prod-litellm.nationalbank.kz:443 \
  -servername prod-litellm.nationalbank.kz \
  -CAfile backend/certs/infowatch-proxy-root.crt </dev/null 2>&1 | grep 'Verify return code'
# expect: Verify return code: 0 (ok)
```
