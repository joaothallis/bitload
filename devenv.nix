{
  pkgs,
  lib,
  config,
  ...
}:
{
  packages = [ pkgs.bitcoind pkgs.k6 ];

  # https://devenv.sh/processes/
  # Since there is no native bitcoind service in devenv,
  # we run them as processes with local directories.
  processes = {
    bitcoin-node-1.exec = "bitcoind -regtest -datadir=$DEVENV_STATE/bitcoin-node-1 -port=18444 -rpcport=18443 -rpcthreads=64 -rpcworkqueue=1024 -printtoconsole -debug=all";
    bitcoin-node-1.restart.on = "never";
    bitcoin-node-1.process-compose.availability.restart = "no";
    bitcoin-node-2.exec = "bitcoind -regtest -datadir=$DEVENV_STATE/bitcoin-node-2 -port=18445 -rpcport=18446 -rpcthreads=64 -rpcworkqueue=1024 -connect=127.0.0.1:18444 -printtoconsole";
    bitcoin-node-2.restart.on = "never";
    bitcoin-node-2.process-compose.availability.restart = "no";
  };

  enterShell = ''
    mkdir -p $DEVENV_STATE/bitcoin-node-1 $DEVENV_STATE/bitcoin-node-2
  '';
}
