# fab0 for Claude Code

[fab0](https://fab0.dev) runs your team's pipelines on GitHub: it follows your issues and pull requests, and hands each step to the people and agents your pipeline names. This plugin connects Claude Code to fab0, so you can see your runs and your queue, and work the steps and acts that wait on you.

It installs:

- **The fab0 MCP server**, at `https://mcp.fab0.dev/mcp`: tools to read runs and your queue, validate and sync pipelines, start, cancel and rebuild runs, and claim and complete work; and the prompt `/mcp__plugin_fab0_fab0__continue`.
- **The `fab0-work` skill**, which takes a step or an act from your queue and does it as the pipeline asks.
- **The `fab0-pipelines` skill**, which writes and changes your repository's `.fab0/pipelines.yml` with you, checks it with fab0, and opens a pull request for it.

## Install

In Claude Code:

```
/plugin marketplace add fab0-dev/claude-plugin
/plugin install fab0@fab0
```

## Sign in

The first fab0 tool call asks you to sign in. Run `/mcp`, choose the fab0 plugin's server, and sign in with GitHub in the browser. fab0 sees the organizations you belong to where the fab0 GitHub App is installed, and nothing else.

## Use

In a checkout of a repository that runs fab0 pipelines:

- `/mcp__plugin_fab0_fab0__continue` shows what waits on you there, and continues with the entry you pick.
- Or ask in your own words: "what's waiting on me in fab0?", "show run 01K…", "take the next fab0 step".
- To write a pipeline, describe how work should flow: "write a fab0 pipeline where a planner breaks each Feature into Stories, and a person reviews each Story's pull request". Or start from a recipe in [fab0-dev/home](https://github.com/fab0-dev/home): "set up the feature-delivery recipe".

Steps and acts are done with your own `git` and GitHub CLI (`gh`), signed in as you. fab0 itself never writes to GitHub. Claude Code's auto mode refuses an act's label change or merge as a write to an external system, so approve those `gh` commands when Claude Code asks, with auto mode off, or allow them for your repositories in `/permissions`.

## Update

```
/plugin update fab0@fab0
```

Then start a new session. When the server needs a newer plugin, the skill stops and tells you so.

## For testers: the dev server

To point the plugin at fab0's `dev` environment, start Claude Code with:

```
FAB0_MCP_URL=https://dev.fab0.dev/mcp claude
```

## License

MIT. See [LICENSE](LICENSE).
