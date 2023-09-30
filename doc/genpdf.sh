set -e
pandoc -o verity.pdf verity.md -f gfm --pdf-engine=xelatex -V geometry:margin=0.75in
pandoc -o cci.pdf cci.md -f gfm --pdf-engine=xelatex -V geometry:margin=0.75in
