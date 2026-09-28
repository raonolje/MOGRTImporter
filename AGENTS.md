# Project workflow

The user requested on 2026-09-28 that this project stay updated in all three places:

- Local working repository: `D:/01/_ClaudeAI/02_MOGRT_Importer`
- GitHub (`origin`): `https://github.com/raonolje/MOGRTImporter.git`
- GitLab (`gitlab`): `https://code.raonolje.synology.me/raonolje/mogrt_importer.git`

For completed changes, run the relevant checks, commit the finished work locally,
then update both remote repositories. This is standing authorization from the user;
do not ask again merely to synchronize these repositories. Keep their `main`
branches on the same final commit and verify the remote commit IDs after pushing.
Preserve others' changes and history. Fetch and reconcile divergence without force
pushing. If authentication or a repository policy prevents synchronization, report
exactly which destination remains out of date.

`extension/html/js/app.js` is the active panel source. `src/` is a historical
reference, not a build input. Preserve the region extraction and core-hash
contracts when refactoring. `extension/jsx/hostscript.jsx` must remain ES3-compatible;
do not replace its loops with `map`, `filter`, `reduce`, or `for...of`.

Separate actual Premiere/model validation from simulator and unit-test results.
Publishing source does not imply an installer release or a production CEP install.
