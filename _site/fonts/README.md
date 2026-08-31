# Self-hosted typefaces

Field Notes uses two families and no others.

| Family | Weights used | Role |
|---|---|---|
| Sora | 300, 400, 600 | All text and headings |
| Roboto Mono | 400, 500 | Code and metadata |

## Files

Both families are served by Google Fonts as **variable** fonts, one file per
subset covering the whole weight range, so four files cover both families at
every weight the site uses. Total is about 105 KB, replacing the five families
the site previously pulled from `fonts.googleapis.com` on every page load.

| File | Subset | Size |
|---|---|---:|
| `sora-latin.woff2` | latin | 33 KB |
| `sora-latin-ext.woff2` | latin-ext | 15 KB |
| `robotomono-latin.woff2` | latin | 32 KB |
| `robotomono-latin-ext.woff2` | latin-ext | 22 KB |

The `unicode-range` on each `@font-face` in `styles.css` matches the subset, so
a page with no latin-ext characters never fetches the second file.

## Origin

Downloaded from `fonts.gstatic.com` on 2026-08-31.

- Sora v17, `xMQbuFFYT72XzQUpDqW1KX4.woff2` and `xMQbuFFYT72XzQspDqW1KX7wmA.woff2`
- Roboto Mono v31, `L0x5DF4xlVMF-BfR8bXMIjhLq3-cXbKD.woff2` and
  `L0x5DF4xlVMF-BfR8bXMIjhFq3-cXbKDO1w.woff2`

All four carry the `wOF2` signature. They are the same subsets Google serves,
already subset to latin and latin-ext, so no build step and no subsetting tool
is involved.

## License

Both families are released under the SIL Open Font License 1.1, which permits
redistribution and web embedding. Neither family is renamed or modified here.

- Sora, by Jonny Pinhorn and Ani Petrova
- Roboto Mono, by Christian Robertson

## Sora has no italic

`fonts.googleapis.com/css2?family=Sora:ital,wght@1,400` returns HTTP 400. The
family ships upright only. There are about 1,165 markdown emphasis spans across
153 math and AI pages, so leaving each browser to synthesize its own slant
would be visibly inconsistent. `styles.css` sets a fixed `oblique 10deg` on
`em, i, cite, dfn, var` instead.

If a paired italic-bearing text face is adopted later, that one rule and the
`--font-sans` token are the only places to change.

## Updating

Refetch the same four URLs, confirm the `wOF2` signature, and check that the
metrics still hold. The measure is `grid: body-width` in `_quarto.yml` and
`--measure-reading` in `styles.css`, both reasoned against Sora's measured
average prose advance of 8.776px at 17.5px and 9.277px at 18.5px, so a metric
change in a future release would move them.
