#!/usr/bin/env bash
cd /mnt/c/Users/filip/OneDrive/Documentos/SiteDock
podman-compose up -d --build > /mnt/c/Users/filip/AppData/Local/Temp/opencode/compose-run.log 2>&1
echo "EXIT:$?" >> /mnt/c/Users/filip/AppData/Local/Temp/opencode/compose-run.log
