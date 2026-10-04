# Bundled fonts

The existing UI font families are bundled so builds work without network access.
Source: Google Fonts, commit `9710da1eacb3be272583c3224dcb70f9da6eadbb`. Each family includes its SIL Open Font License.

- `Geist-Variable.ttf`: [source](https://raw.githubusercontent.com/google/fonts/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/geist/Geist%5Bwght%5D.ttf); SHA-256 `73894e0448cae90a92b6c2f8732b7bb9acb7b94c418bff559dad4a18e1de9659`
- `geist-OFL.txt`: [source](https://raw.githubusercontent.com/google/fonts/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/geist/OFL.txt); SHA-256 `fb64c1011862d97fe49c633ad9180ffd80a61aab6ff220a2935704e8a0c3a7c4`
- `GeistMono-Variable.ttf`: [source](https://raw.githubusercontent.com/google/fonts/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/geistmono/GeistMono%5Bwght%5D.ttf); SHA-256 `d00e590b8eb3a59acc329b2d044fd143ae935090b7da33199ebee27cc7de8196`
- `geistmono-OFL.txt`: [source](https://raw.githubusercontent.com/google/fonts/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/geistmono/OFL.txt); SHA-256 `fb64c1011862d97fe49c633ad9180ffd80a61aab6ff220a2935704e8a0c3a7c4`
- `Manrope-Variable.ttf`: [source](https://raw.githubusercontent.com/google/fonts/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/manrope/Manrope%5Bwght%5D.ttf); SHA-256 `3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6`
- `manrope-OFL.txt`: [source](https://raw.githubusercontent.com/google/fonts/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl/manrope/OFL.txt); SHA-256 `d6a309fcfb963d329a93baf9df66fa5f3c23a4be2b5f67edf24d6cafecde12ac`

## Loading, layout and redistribution

These files are reused from the local `origin/fix/qa-lint-baseline`
commit `ea9053e8b51e5ed112b99547e245d1953e8c4b84`; no download is needed.
Font binaries are unmodified. License notices have only trailing spaces removed;
their wording is unchanged. The hashes above describe the bundled files after
this whitespace normalization.
`next/font/local` emits same-origin hashed assets and preloads them. Existing
`--font-geist-sans`, `--font-geist-mono`, `--font-manrope` variables remain intact,
with normal variable weights 100–900, 100–900 and 200–800 respectively and
`display: swap`. AgentTab and HolderModal keep Manrope; sans/mono utilities keep
Geist/Geist Mono. No component sizing, spacing or line-height is changed.

The full TTFs total 505,704 bytes before transport compression, rather than
Google's subset WOFF2 responses. This increases font transfer size; the first
paint still uses a fallback until the fonts load. Next's local fallback metrics
may differ from the Google loader's metrics, so identical pixel layout/CLS is
not claimed. Korean text continues to use platform fallback glyphs. Browser
visual comparison on mobile and desktop remains a release check.

All three families use SIL OFL 1.1. Preserve the corresponding copyright and
full OFL notice when redistributing fonts; do not sell the font files alone.
The fonts remain OFL licensed (the application does not thereby become OFL).
No font outlines, names or licensing metadata were modified. Original notices
are included alongside the fonts and are also served at `/fonts/*-OFL.txt` so
users of the deployed application can read them.
