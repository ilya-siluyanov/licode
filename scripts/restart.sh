#!/usr/bin/bash
set -x

./scripts/get_pids.sh | xargs kill
./scripts/initLicode.sh ; ./scripts/initBasicExample.sh