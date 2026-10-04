# Artwork sources

Generated with ChatGPT (chatgpt.com, chat "Create app logo mark", 2026-10-04) through Claude in Chrome.
Originals go in `data/art/src/`; `python data/art/process.py` turns them into the files under `apps/web/public/`.

Shared rules in the first message: one single image, no collage, no panels, no device mockups, no watermark, no extra text.
Palette "Midnight Acoustic Lab": graphite #05070b, cyan #22d3ee (pressure), lime #a3e635 (air), amber #fbbf24 (heat), magenta #f0abfc (warnings).

| File (src) | Size | Used as | Prompt (short) |
|---|---|---|---|
| `logo.png` | 1254² RGBA | `brand/logo-*.png`, favicons, top bar, splash, OG card | App logo mark, icon only, transparent background: a subwoofer cone of concentric rings with sound-pressure arcs that read as a "B"; cyan with a lime accent; thick enough for 32 px |
| `splash.png` | 1672×941 | `art/splash.webp`, OG card background | Subwoofer cabinet (walnut sides, black baffle) in a dark anechoic chamber, measurement mic, cyan pressure rings on the floor, lime airflow from the slot port; ~75 % near-black |
| `teaser-ai.png` | 1672×941 | `art/teaser-ai.webp` | Dozens of enclosure variants as glowing wireframes evolving left to right, linked by cyan lines, one solid "winner" cabinet on the right |
| `teaser-blueprint.png` | 1672×941 | `art/teaser-blueprint.webp` | Exploded isometric technical drawing of the cabinet panels in white-cyan lines on navy-black, dimension lines without numbers, sheet-nesting diagram |
| `teaser-library.png` | 1672×941 | `art/teaser-library.webp` | Studio wall of drivers from 5" to 21" on floating shelves, mixed cone materials, cyan rim light, one highlighted as selected; no brand logos |
| `walnut.png` | 1254² | `tex/walnut.webp` | Flat evenly lit scan of American black walnut veneer, straight grain left to right, no edges/shadows/vignette/knots |
| `oak.png` | 1254² | `tex/oak.webp` | Same rules: European white oak, rift-sawn, ray flecks, honey-tan |
| `teak.png` | 1254² | `tex/teak.webp` | Same rules: Burmese teak, straight grain, golden-brown |

The veneer scans are not seamless; the 3D view tiles them mirrored (`MirroredRepeatWrapping`), which reads as book-matched veneer.
