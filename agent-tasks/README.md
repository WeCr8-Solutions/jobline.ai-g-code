# Agent tasks

One Markdown file per job. `node tools/agent-loop/cli.mjs run` picks up every
enabled task in this folder (not subfolders) and works on it in its own git
worktree and `agent/<id>` branch until the checks pass, then commits there for
a person to review and merge. See [tools/agent-loop/README.md](../tools/agent-loop/README.md).

Start one with `node tools/agent-loop/cli.mjs new "Title"`, or copy a file
from [examples/](examples) up into this folder.
