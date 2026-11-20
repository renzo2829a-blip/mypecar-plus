#!/bin/sh
# Prepara la carpeta dist con solo los archivos públicos del sitio.
set -e
rm -rf dist
mkdir dist
cp ./*.html ./*.js dist/
cp -r fonts dist/fonts
cp -r img dist/img
