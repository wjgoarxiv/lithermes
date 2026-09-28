// Publicly discoverable automatic-update surface. The implementation remains
// next to the advisory notifier so the cache-only worker and foreground
// transaction share strict semver/registry helpers without a dependency loop.
module.exports = require("./updateNotifier");
