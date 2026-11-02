#!/bin/sh
# Download the official Ookla Speedtest CLI (x86_64) used for cross-validation.
set -eu
mkdir -p /home/user/speedtest-cli/x86_64
cd /home/user/speedtest-cli
wget -q https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-linux-x86_64.tgz
tar xzf ookla-speedtest-1.2.0-linux-x86_64.tgz -C x86_64
sha256sum ookla-speedtest-1.2.0-linux-x86_64.tgz x86_64/speedtest
