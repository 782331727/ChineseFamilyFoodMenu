#!/bin/bash
npx mcporter call cloudbase.manageFunctions action=invokeFunction functionName=dish-public 'func={"name":"dish-public","params":{"page":1,"pageSize":20}}' --output json > "C:/Users/ASUS/.openclaw-autoclaw/workspace/zhangjie-menu/.test-tmp/dp-full.json" 2>&1
