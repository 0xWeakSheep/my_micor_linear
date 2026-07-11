#!/bin/sh
set -eu

umask 077
npm run prestart
npm run db:init
exec node node_modules/next/dist/bin/next start
