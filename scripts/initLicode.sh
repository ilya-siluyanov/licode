#!/usr/bin/env bash

SCRIPT=`pwd`/$0
FILENAME=`basename $SCRIPT`
PATHNAME=`dirname $SCRIPT`
ROOT=$PATHNAME/..
BUILD_DIR=$ROOT/build
CURRENT_DIR=`pwd`
EXTRAS=$ROOT/extras

export PATH=$PATH:/usr/local/sbin

if ! pgrep -f rabbitmq; then
  sudo echo
  sudo rabbitmq-server > $BUILD_DIR/rabbit.log &
  sleep 3
fi

cd $ROOT/nuve
./initNuve.sh &
cd $ROOT/scripts

sleep 3

export ERIZO_HOME=$ROOT/erizo/

cd $ROOT/erizo_controller
./initErizo_controller.sh &
./initErizo_agent.sh &
cd $ROOT/scripts

echo [licode] Done, run ./scripts/initBasicExample.sh
./initBasicExample.sh &
