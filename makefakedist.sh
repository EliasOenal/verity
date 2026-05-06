#!/bin/bash

# This is a helper script to make a fake dist directory, allowing
# to import a local full-repo copy of Verity into a separate Verity-based
# application project the same way as you'd use the npm package.

mkdir fakedist
cd fakedist
ln ../package.json .
ln -s ../src/* .
ln ../webpack.base.mjs .
ln ../webpack.veritycommon.mjs .
ln -s ../img .
