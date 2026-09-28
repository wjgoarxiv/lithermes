const path = require("node:path");
const { refreshUpdateCache } = require("./updateNotifier");

const cachePath = process.argv[2];
const attemptOwner = process.argv[3];

if (cachePath && path.isAbsolute(cachePath) && attemptOwner) {
  refreshUpdateCache(cachePath, { attemptOwner }).catch(() => {});
}
