# Pulse

A local brief cabinet. It stores editions, watches, and reading marks in the
Host data directory. The panel projects that cabinet into a brief, an activity
list, and watches.

This slice does not run a daily agent, read sessions, or approve actions. A
watch cadence is saved for a later runner. Publishing the same edition twice
keeps one edition; seen, dismissed, and feedback are not part of the publish
body.

```sh
npm test --prefix apps/pulse
npm run test:ui --prefix apps/pulse
node scripts/build/apps.mjs --app pulse
```

Python 3 must be on the machine. The Desktop Host starts `backend/server.py`.
