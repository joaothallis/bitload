# bitload

Load-test setup for Bitcoin Core on `regtest` using `devenv` and `k6`.

This repository starts two local `bitcoind` nodes and runs a high-throughput transaction load test against node 1 while optionally checking propagation to node 2.

## Prerequisites

- Nix with [devenv](https://devenv.sh/)
- `direnv` (optional, but convenient)

## Quick start

1. Enter the development shell:

```bash
devenv shell
```

2. Start the local processes:

```bash
devenv up
```

3. In another terminal, run the load test:

```bash
k6 run script.js
```

## View process logs

Use this command to follow `process-compose` logs:

```bash
tail -f .devenv/state/process-compose/process-compose.log
```

## Test configuration

The load test reads environment variables (all optional):

- `RPC_A_URL` (default: `http://127.0.0.1:18443`)
- `RPC_B_URL` (default: `http://127.0.0.1:18446`)
- `WALLET_NAME` (default: `loadtest`)
- `RPC_A_COOKIE` (default: `.devenv/state/bitcoin-node-1/regtest/.cookie`)
- `RPC_B_COOKIE` (default: `.devenv/state/bitcoin-node-2/regtest/.cookie`)
- `MIN_TRUSTED_BALANCE` (default: `5000`)
- `TOP_UP_BLOCKS` (default: `1200`)
- `TX_AMOUNT` (default: `0.00001`)
- `FEE_RATE` (default: `1.0`)
- `CHECK_PROPAGATION=1` to collect propagation latency metric

Example:

```bash
CHECK_PROPAGATION=1 TX_AMOUNT=0.00002 k6 run script.js
```

For a quick rerun without any setup mining, use:

```bash
k6 run -e MIN_TRUSTED_BALANCE=0 script.js
```

## Node status report script

Run the status collection script:

```bash
scripts/report-node-status.sh
```

Custom usage:

```bash
scripts/report-node-status.sh <node_name> <datadir> <outfile>
```

Examples:

```bash
scripts/report-node-status.sh bitcoin-node-1 .devenv/state/bitcoin-node-1 bitcoin-node-1-status.txt
scripts/report-node-status.sh bitcoin-node-2 .devenv/state/bitcoin-node-2 bitcoin-node-2-status.txt
```
