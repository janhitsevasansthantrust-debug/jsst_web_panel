# Fonts

`NotoSansDevanagari-*.ttf` — SIL Open Font License 1.1, from Google's Noto
project.

They are committed rather than fetched at build time on purpose. @react-pdf
needs the font bytes at render time; downloading them then would make every
receipt depend on a network call to a third party, and a PDF that renders
Hindi as empty boxes when that call fails is worse than one that never
renders.
