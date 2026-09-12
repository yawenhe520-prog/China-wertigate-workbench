#!/bin/zsh
cd "${0:A:h}" || exit 1
workbench_node="$(command -v node)"
if [[ -z "$workbench_node" ]]; then
  workbench_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$workbench_node" ]]; then
  print "请先安装 Node.js 20 或更高版本，再重新打开此文件。"
  read -k 1
  exit 1
fi
"$workbench_node" server.mjs
