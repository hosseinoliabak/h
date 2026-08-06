Leela-family neural network opponents — provenance and licenses
===============================================================

maia-1100/1300/1400/1600/1700/1900.onnx.gz
  Maia Chess networks by the University of Toronto CSSLab
  (https://github.com/CSSLab/maia-chess, GPL-3.0), converted from the
  official v1.0 release weights (maia-<elo>.pb.gz) to ONNX with
  "lc0 leela2onnx" and gzipped. Maia: McIlroy-Young, Sen, Kleinberg,
  Anderson — "Aligning Superhuman AI with Human Behavior: Chess as a
  Model System", KDD 2020.

t70-703810.onnx.gz
  Official Leela Chess Zero training-run network T70 id 703810
  (128x10, July 2020), downloaded from training.lczero.org, converted
  with "lc0 leela2onnx" and gzipped. Leela Chess Zero is GPL-3.0
  (https://github.com/LeelaChessZero/lc0).

leela-policy.js
  1858-entry policy-index-to-UCI table generated from lc0
  src/neural/encoder.cc kMoveStrs (GPL-3.0, (C) The LCZero Authors).

leela.js
  Position encoder (lc0 INPUT_CLASSICAL_112_PLANE format), model wrapper
  and move sampling for this site.

ort.wasm.bundle.min.mjs, ort-wasm-simd-threaded.mjs,
ort-wasm-simd-threaded.wasm
  ONNX Runtime Web 1.27.0 (https://github.com/microsoft/onnxruntime,
  MIT license), unmodified dist files.
