# Autoresearch dependency binding

The conference researcher protocol depends on the installed
`lithermes:autoresearch` family skill at `../autoresearch/SKILL.md` relative to the
plugin skill catalog. Before dispatch, the root Conference Chair must load that
contract and the selected core/mode reference. The source family may discuss
independent mutation, but the conference contract overrides it: conference children are
`delegation_allowed: false`, return result packets only, and never write shared
conference state. The root applies validated packet content under its own bounded
authority.

If the registered dependency, its mode file, or its payload hash is missing, return
`BLOCKED_AUTORESEARCH_DEPENDENCY_UNAVAILABLE`; do not substitute an abbreviated
prompt or pretend the five-stage loop was loaded.
