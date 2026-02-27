# Load Test Analysis - 2026-02-27

## Scope
Inputs analyzed:
- `before-running-test-bitcoin-node-1-status.txt`
- `setup-bitcoin-node-1-status.txt`
- `after-test-bitcoin-node-1-status.txt`
- `.devenv/state/process-compose/process-compose.log`
- k6 result summary for `k6 run -e TOP_UP_BLOCKS=101 script.js`

## Executive Summary
Primary failure mode: `bitcoin-node-1` exhausted file descriptors during peak load, causing the RPC listener to fail accepting new connections (`Too many open files`). That produced widespread k6 request timeouts and a 99% HTTP failure rate.

This is consistent with the observed metrics:
- `http_req_failed=99.00%` (2984/3014)
- `send_success_rate=0.83%` (25/3008)
- Many requests hitting the 60s timeout ceiling (`p(90)=1m`, `p(95)=1m`)

## Timeline (America/Sao_Paulo and UTC)
- `2026-02-27 13:38:18 -03` (`16:38:18Z`): pre-test snapshot, chain at block 0, mempool empty.
- `2026-02-27 13:38:57 -03` (`16:38:57Z`): setup snapshot, chain at block 35, `generatetoaddress` still active.
- `2026-02-27 16:39:14Z`: RPC starts receiving high volume `sendtoaddress` calls.
- `2026-02-27 16:39:27Z` (first occurrence): node log shows `Error from accept() call: Too many open files`.
- `2026-02-27 16:40:24Z`: same error still repeating heavily.
- `2026-02-27 13:41:31 -03` (`16:41:31Z`): post-test snapshot, chain at block 101, only 25 tx in mempool, many long-running `sendtoaddress` RPC commands still active.

## Evidence
1. File descriptor cap present at startup:
- `.devenv/state/process-compose/process-compose.log` shows:
  - `Using at most 125 automatic connections (1024 file descriptors available)`
  - `rpcthreads="64"`
  - `rpcworkqueue="1024"`

2. Direct FD exhaustion signal during test:
- First matching line:
  - `54634: ... 2026-02-27T16:39:27Z ... Error from accept() call: Too many open files`
- Total occurrences in log:
  - `1,917,135`

3. Request volume/concurrency exceeded practical capacity:
- k6 scenario peaked at `maxVUs=2000` with target arrival rate up to `2000/s`.
- Node had only `1024` FDs available, so incoming connection acceptance collapsed under load.

4. Backend saturation after collapse:
- `after-test-bitcoin-node-1-status.txt` `getrpcinfo` shows many `sendtoaddress` commands with multi-second to ~23s durations.
- `getmempoolinfo.size=25`, matching only `25` successful sends from k6.

## Root Cause
The load profile drove more concurrent RPC connections than the node's OS/process file-descriptor limit could support. Once the listener hit FD exhaustion, `accept()` failed repeatedly, leading to request timeouts and near-total failure in k6.

## Secondary Contributors
- Very aggressive load shape (`ramping-arrival-rate` to 2000/s, `maxVUs=2000`) for a single local regtest RPC endpoint.
- `script.js` issues one RPC per iteration with no client-side backpressure/adaptive throttling.
- Debug logging at `debug=all` likely increased overhead during saturation (not primary root cause).

## Recommended Next Runs
1. Raise file descriptor limits for the bitcoind process (and parent shell/service), then verify with runtime checks before test.
2. Start with a lower ceiling (example: 50 -> 100 -> 200 -> 400 req/s) and find the breaking point incrementally.
3. Keep `rpcthreads`/`rpcworkqueue` as tuning levers, but treat FD limits first; queue/thread tuning does not fix failed `accept()`.
4. Add explicit k6 connection controls and staged ramp tuning to avoid instant connection storms.
5. Run a short calibration test (30-60s) after each tuning change and confirm no `Too many open files` in logs.

## Conclusion
The test failure is not primarily a Bitcoin RPC logic error; it is an infrastructure/resource-limit failure at the RPC socket acceptance layer (FD exhaustion), which then surfaces as client timeouts and low success rate.
