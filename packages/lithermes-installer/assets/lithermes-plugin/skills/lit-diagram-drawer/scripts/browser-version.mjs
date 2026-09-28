/** Return whether an agent-browser version is stable and at least 0.38.1. */
export function agentBrowserSupported(output) {
  const match = String(output).match(
    /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?(?=\s|$|\))/,
  );
  if (!match) return false;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (major !== 0) return major > 0;
  if (minor !== 38) return minor > 38;
  if (patch !== 1) return patch > 1;
  return !match[4];
}
