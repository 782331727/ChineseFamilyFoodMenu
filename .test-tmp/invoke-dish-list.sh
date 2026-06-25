#!/bin/bash
npx mcporter call cloudbase.manageFunctions action=invokeFunction functionName=dish-list 'func={"name":"dish-list","params":{"page":1,"pageSize":2}}' --output json > "C:/Users/ASUS/.openclaw-autoclaw/workspace/zhangjie-menu/.test-tmp/dish-list.json" 2>&1
