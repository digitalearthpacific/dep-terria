#export NODE_OPTIONS=--max_old_space_size=4096
#export NODE_OPTIONS=--openssl-legacy-provider
yarn install
yarn gulp release
node ./node_modules/terriajs-server/terriajs-server.js

