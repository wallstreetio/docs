---
name: check-main-updates
description: Look in main repo and propose changes for docs for things that have changed.
disable-model-invocation: true
---
# Check main repo for updates

## Instructions 

* Read agent-workspace/change-log.md
* Look in the main repo for UI changes that affect components that are visible. The main repo is in ~/wallstreetio. If the branch is not on master, then stop and warn the user. Look for changes since the end commit for the last entry in change-log.md. Use a new scratch_change_log.md to keep track of what you find.
* Propose changes to these docs as a list of numbers.
* User will specify which numbers to implement
* Once implemented add entry to change-log.md

