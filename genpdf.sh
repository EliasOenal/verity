set -e
pandoc -o verity.pdf verity.md -f gfm --pdf-engine=xelatex
