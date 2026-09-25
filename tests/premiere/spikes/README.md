# S0-3 실측 스크립트 (배포하지 않음)

- 결과와 결정은 `docs/spike_s0.md`에 있다.
- 실행: `node tests/premiere/run.js --port 7778 tests/premiere/spikes/<파일>.jsx` (DEV 패널, MI_test.prproj, T_ 시퀀스).
- `presets_data.jsx`(실제 프리셋에서 뽑은 `S03_PRESETS`)는 운영 캐시에서 로컬로만 만든다. 사용자 데이터라 저장소에 넣지 않는다. 이 변수를 쓰는 스크립트(a, b, c, d_f_prep, g, j, r, s_big2, x_step2)는 그 파일을 먼저 로드해야 한다.
- `native_bake.py`: 네이티브 `.mogrt`에 문구를 구워 사본을 만든다(`docs/spike_s0.md` §3-1a). 만든 `.mogrt`는 커밋하지 않는다.
