#!/bin/sh
set -eu
mkdir -p /home/user/ooklaserver
cd /home/user/ooklaserver
wget -q https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-x86_64-static-musl.tgz
wget -q https://install.speedtest.net/ooklaserver/stable/OoklaServer-linux-aarch64-static-musl.tgz
mkdir -p x86_64 aarch64
tar xzf OoklaServer-linux-x86_64-static-musl.tgz -C x86_64
tar xzf OoklaServer-linux-aarch64-static-musl.tgz -C aarch64
