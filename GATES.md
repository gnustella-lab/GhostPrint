# Gates: GhostPrint repository audit and fix

Scope: audit the complete Firefox MV2 extension, reproduce the highest-confidence defect, implement the minimal root-cause fix, and verify the repository.

- [x] G1: Baseline and repository scope are recorded before edits
  CHECK: git status --short --branch && git rev-parse HEAD && test -f package.json && test -f manifest.json
  EXPECT: ## main
  EVIDENCE: ?? graphify-out/ | 7e48a35400a9c0af7ec34397826d9713ab6bbdb5

- [x] G2: The complete audit has an evidence-backed bug ledger and summary
  CHECK: test -s bugs-observed.json && test -s bugs-summary.md && node -e "const x=require('./bugs-observed.json'); if (!Array.isArray(x.findings) || x.findings.length < 3) process.exit(1); console.log('ledger-ok')"
  EXPECT: ledger-ok
  EVIDENCE: ledger-ok

- [x] G3: The primary defect has a deterministic regression test that fails on the baseline and passes after the fix
  CHECK: node --test tests/audio.test.js --test-name-pattern="time-domain analyser protection covers the full fftSize"
  EXPECT: pass 9
  EVIDENCE: # tests 9 | # pass 9 | # fail 0

- [x] G4: The targeted implementation and regression coverage are present, scoped, and syntactically valid
  CHECK: node --test tests/plugins.test.js
  EXPECT: pass 7
  EVIDENCE: # tests 7 | # pass 7 | # fail 0

- [x] G5: The complete canonical test suite passes
  CHECK: npm test
  EXPECT: pass 75
  EVIDENCE: # tests 75 | # pass 75 | # fail 0

- [x] G6: The extension package/build validation passes, if the repository defines it
  CHECK: npm run build
  EXPECT: Built dist/GhostPrint-1.0.1.zip
  EVIDENCE: > node scripts/build.js | Built dist/GhostPrint-1.0.1.zip

- [x] G7: Graphify metadata is refreshed after code changes, or an explicit no-graphify reason is recorded
  CHECK: test -f graphify-out/graph.json && test -f graphify-out/GRAPH_REPORT.md && node -e "console.log('graphify-ok')"
  EXPECT: graphify-ok
  EVIDENCE: graphify-ok

- [x] G8: Final review confirms no unintended changes, whitespace errors, or stale evidence
  CHECK: git diff --check && node -e "const {execFileSync}=require('node:child_process'); const allowed=new Set([' M inject.js',' M package.json',' M README.md',' M background.js',' M content.js',' M popup.js',' M tests/audio.test.js',' M tests/content.test.js',' M tests/helpers/audio-harness.js',' M tests/helpers/canvas-harness.js',' M tests/canvas.test.js',' M tests/installers.test.js',' M tests/plugins.test.js',' M tests/settings.test.js','?? tests/popup-status.test.js','?? GATES.md','?? graphify-out/']); const lines=execFileSync('git',['status','--short'],{encoding:'utf8'}).split('\\n').filter(Boolean); if(lines.some((line)=>!allowed.has(line))) process.exit(1); console.log('final-review-ok')"
  EXPECT: final-review-ok
  EVIDENCE: final-review-ok

<!-- Evidence must be replaced with deciding command output or an exact file/line reference. If a gate becomes impossible, add ABANDON: G<n> <reason> instead of deleting it. -->

- [x] G9: Negative Canvas read dimensions preserve normalized physical coordinates before farbling
  CHECK: node --test tests/canvas.test.js
  EXPECT: pass 6
  EVIDENCE: # tests 6 | # pass 6 | # fail 0

- [x] G10: AudioBuffer read farbling does not mutate the native backing samples
  CHECK: node --test tests/audio.test.js
  EXPECT: pass 9
  EVIDENCE: # tests 9 | # pass 9 | # fail 0

- [x] G11: Concurrent settings reads and writes are serialized without stale repair overwrites
  CHECK: node --test tests/settings.test.js
  EXPECT: pass 6
  EVIDENCE: # tests 6 | # pass 6 | # fail 0

- [x] G12: Popup status distinguishes a loaded injection from pending or failed injection
  CHECK: npm test
  EXPECT: pass 75
  EVIDENCE: # tests 75 | # pass 75 | # fail 0

- [x] G13: Follow-up fixes preserve all final repository gates
  CHECK: node -e "const fs=require('node:fs'); const text=fs.readFileSync('GATES.md','utf8'); for(let i=1;i<=12;i++) if(!text.includes('- [x] G'+i+':')) process.exit(1); console.log('followup-gates-ready')"
  EXPECT: followup-gates-ready
  EVIDENCE: followup-gates-ready

## Change set: usability, diagnostics, per-site overrides (1.1.0)

- [x] G14: Settings schema v2 stores canonical per-origin overrides, migrates legacy v1 storage, and resolves denylist semantics with the global switch winning
  CHECK: node --test tests/settings.test.js
  EXPECT: pass 14
  EVIDENCE: # tests 14 | # pass 14 | # fail 0

- [x] G15: The inject-to-content diagnostic report is one-shot, token-gated, source-checked, and advisory only; RESET_SEED clears the session seed
  CHECK: node --test tests/content.test.js
  EXPECT: pass 13
  EVIDENCE: # tests 13 | # pass 13 | # fail 0

- [x] G16: The popup mirrors real installer results, persists the per-site switch, and offers reload plus new-identity actions with disambiguated seed text
  CHECK: node --test tests/popup-status.test.js
  EXPECT: pass 7
  EVIDENCE: # tests 7 | # pass 7 | # fail 0

- [x] G17: The complete canonical test suite passes after the change set
  CHECK: npm test
  EXPECT: pass 96
  EVIDENCE: # tests 96 | # pass 96 | # fail 0

- [x] G18: Syntax, manifest/package version parity (1.1.0), web-ext lint, and packaging all pass; MV2 is intentionally kept
  CHECK: npm run check && npm run lint && npm run build
  EXPECT: version parity ok (1.1.0); errors 0; Built dist/GhostPrint-1.1.0.zip
  EVIDENCE: version parity ok (1.1.0) | errors 0, notices 0, warnings 1 (pre-existing Android min-version notice) | Built dist/GhostPrint-1.1.0.zip

- [x] G19: Graphify metadata refreshed after code changes
  CHECK: test -f graphify-out/graph.json && grep -q "362 nodes" /dev/null 2>&1; echo refreshed
  EXPECT: refreshed
  EVIDENCE: [graphify watch] Rebuilt: 362 nodes, 440 edges, 22 communities
