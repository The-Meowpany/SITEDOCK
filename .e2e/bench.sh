#!/bin/sh
# Warm/cold timing of the podman calls the runtime agent makes most often.
CID="$1"
now_ms() { date +%s%3N; }

for i in 1 2 3; do
  s=$(now_ms); podman --cgroup-manager=cgroupfs inspect "$CID" >/dev/null 2>&1; e=$(now_ms)
  echo "inspect#$i $((e - s))ms"
done

s=$(now_ms); podman --cgroup-manager=cgroupfs ps -a --format json >/dev/null 2>&1; e=$(now_ms)
echo "ps-json $((e - s))ms"

s=$(now_ms); podman --cgroup-manager=cgroupfs inspect "$CID" >/dev/null 2>&1; e=$(now_ms)
echo "inspect-after-ps $((e - s))ms"
