#!/bin/bash
cd lumina-design-workstation
npm install
npm run build
cp -r dist ../dist
