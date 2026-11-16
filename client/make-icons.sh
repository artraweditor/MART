#!/bin/sh
# Renders the PNG icons of the app from icons/MART-portrait.svg (needs rsvg-convert, from librsvg).
# The PNGs are committed, so this is only needed when the picture changes.
set -e
cd "$(dirname "$0")/icons"
SRC=MART-portrait.svg
rsvg-convert -w 192 -h 192 "$SRC" -o icon-192.png
rsvg-convert -w 512 -h 512 "$SRC" -o icon-512.png
rsvg-convert -w 32 -h 32 "$SRC" -o favicon-32.png
# maskable (the system crops it to a circle or a rounded square): the picture in the central 72 %, on an opaque background
rsvg-convert -w 368 -h 368 --page-width 512 --page-height 512 --left 72 --top 72 -b white "$SRC" -o icon-maskable-512.png
# apple-touch-icon: iOS wants an opaque square and rounds the corners itself
rsvg-convert -w 150 -h 150 --page-width 180 --page-height 180 --left 15 --top 15 -b white "$SRC" -o apple-touch-icon.png
