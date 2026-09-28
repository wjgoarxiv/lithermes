# Notice

This plugin is a Hermes-native adaptation of the bundled workflow reference:

- Repository: bundled workflow reference
- Reference commit inspected for this port:
  `3fb8802e314dc0a1f23481dd3782cdca26b92dc2`

The runtime implementation here is not a vendored upstream runtime. LitHermes
re-implements command dispatch against Hermes' plugin, hook, skill, and LSP
surfaces.

## TokyoNight palette attribution

The `lithermes-tokyonight-day` and `lithermes-tokyonight` palette values are
derived from [`folke/tokyonight.nvim`](https://github.com/folke/tokyonight.nvim/tree/cdc07ac78467a233fd62c493de29a17e0cf2b2b6)
at commit `cdc07ac78467a233fd62c493de29a17e0cf2b2b6`; no upstream code is
copied. The upstream palette source carries an Apache-2.0 `LICENSE`; generated
Kitty palette headers carry a separate MIT notice. Those notices are distinct
from the LitHermes package license.

The bundled skill markdown is adapted from MIT-licensed workflow guidance, with
Hermes-specific command mapping for `/lit`,
`/lit-loop`, `/lit-plan`, `/lit_loop`, and `/lit_plan`.

## MIT License Notice

Copyright (c) 2026 Yeongyu Kim

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
