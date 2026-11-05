---
name: fab0-pipelines
description: Writes and changes fab0 pipelines, one at a time, from a person's description, a recipe from fabtend/home or a pipeline fab0 already holds. Validates each draft with the fab0 MCP tools until no error is left, puts it, reports each warning with what to do (a secret to set, with the command the person runs before the put), and commits .fab0/pipelines.yml through a pull request when the person keeps it in a repository. Use when the person asks to write, change, fix or explain a fab0 pipeline or a pipelines file, describes how work should move between people, agents and their GitHub issues and pull requests (steps, reviews, approvals, loops, children), names a fab0 recipe, or asks why a pipeline is invalid or what a validation warning means.
license: MIT
compatibility: Needs the fab0 MCP server (the fab0 plugin for Claude Code). Committing the file needs git and the GitHub CLI (gh) signed in as the person; setting a secret needs curl in the person's own shell.
metadata:
  version: "2"
  plugin: "1.0.0"
---

# Write a fab0 pipeline

fab0 holds a team's pipelines and their runs. A pipeline is a state machine written as one YAML document: its states fire steps at executors the team owns (a Claude Code routine, their own service, or a person's queue) and wait for signals from people, agents and GitHub. This skill writes or changes one pipeline with the person, validates it with fab0 until it has no error, and puts it. When the person keeps their pipelines in a repository, it also commits the file through a pull request.

[reference.md](reference.md) is the format: the file, every key, executor, state key and signal, the GitHub signals and their fields, the limits, and every validation code with its fix, ending with whole pipelines that validate. Read it before you write.

## Rules

- Write only what reference.md describes. Never invent a key, a signal, a field or a value. If the person asks for something a pipeline can't say (an expression, a template, fab0 writing to GitHub), tell them, and offer the nearest thing it can.
- One pipeline at a time: one YAML document. In a file of several, leave every other document exactly as it is, byte for byte: each document's text is its pipeline's version.
- fab0 decides nothing. Every decision is a state that waits for a signal; ask the person who sends it, and name them in `by`.
- A secret's value never passes through you. Never ask for it, read it, print it, or put it in a file, a tool call or a command you run. The person sets it from their own shell, with the command you give them (3).
- Use the person's own `git` and `gh`. For every change on GitHub, use the REST API (`gh api`), never GraphQL. Never push to the default branch unless the person tells you to.

## 1. Understand

Call `whoami`. Its `tenants` are the accounts that installed fab0; each has an `id` and `admin`. Use the tenant the person names when there are several. Only an admin of the tenant can put a pipeline or set a secret: if the person isn't one, say so now, and that an admin will have to put it.

Start from one of:

- **The person's description**, or their raw ideas.
- **A recipe**, a tested pipeline from `fabtend/home`. List them with `gh api repos/fabtend/home/contents/recipes --jq '.[].name'`, and read one with `gh api repos/fabtend/home/contents/recipes/<name>.yml -H "Accept: application/vnd.github.raw+json"`. A recipe names the people, repositories and skills it was tested with (`your-login`, `reviewer-login`): replace each with the person's own, and name only skills their repository holds or will hold. Change as little else as you can.
- **A pipeline fab0 holds**, to change. fab0 keeps its text where it came from: the repository's `.fab0/pipelines.yml`, or the file the person put. Read that text. Call `validate_pipeline` with `tenant` and `name` for the report fab0 stored for its active version: its `version`, and the errors and warnings it was put with. Then call `validate_pipeline` with the text (as in 3): when its document's `version` equals the stored one, the text is what runs. If they differ, or the person has no text, tell them, and write the pipeline again from the description.

A step that a routine or `fab0-work` runs names its skill in `with.skill`. List the skills the repository holds, the folders of `.claude/skills/` in the person's checkout, or in another repository with `gh api repos/<owner>/<repo>/contents/.claude/skills --jq '.[].name'`.

Ask only what the start doesn't answer and reference.md can't default:

- what starts a run: a person (`on: api`), or a GitHub event, with the label or issue type it needs;
- each step: who or what works it (a routine, a service, or people's queue), and the skill or instructions it follows;
- each decision: who makes it, as GitHub logins, and where it leads;
- what ends a run, as success and as failure.

Tell the person which defaults you used for everything else.

## 2. Write

Write one document, from the start you chose and reference.md:

- A new file begins with the modeline, `# yaml-language-server: $schema=https://schema.fab0.dev/pipeline.v2.json`, on its first line. Keep it in a file that has one, and add it to one that doesn't.
- The document begins with `version: 2` and its `name`. A new document in an existing file goes at its end, after a line `---`; a changed one is edited in place.
- Every state with `run` handles `done` and `failed`. Every state that waits on people has a `timeout` and handles it, unless a person always answers.
- Give every decision its `by`, and name groups of people under `people`.
- A state that waits for a pull request's events needs a step before it that links the pull request (reference.md section 6); a step worked by `fab0-work` does.
- Give a step `outputs` when a later transition branches on its result, and branch with `where` on the field.
- Name each secret by `secret: NAME`. Never write a value.

## 3. Validate until clean

1. Call `validate_pipeline` with `tenant` and `text` when the person is an admin of the tenant, otherwise with `text` alone. `text` is the whole file, not only your document, so names are checked across documents. With `tenant`, fab0 adds the store's warnings (`secret-unset`, `unknown-pipeline`) to each valid document, as `put_pipeline` would, and stores nothing; a member is refused `forbidden`, so use `text` alone for them.
2. If the answer has `problems`, a YAML error or a file cap, it has no documents: fix those first.
3. For each error of your document, go to its `path` (and its `line`), and apply its `fix`. `adapter-signal` and `adapter-field` list the signals or fields to choose from. When a fix leaves a choice, take it from the code's row in reference.md section 9, or ask the person.
4. Call `validate_pipeline` again, the same way. Repeat until your document has no error.

If an error is still there after you applied its fix twice, stop, and show it to the person with what you tried. Show the person any errors in documents you didn't change, and leave them: they are another change.

**Before the put**, give the person the secrets command for each `secret-unset` warning, so the secret is set when the pipeline goes live, not after. Give them this command to run in their own shell:

```bash
pbpaste | curl -fsS -X PUT "https://<host>/api/v1/secrets/<NAME>?tenant=<tenant id>&origin=<origin>" \
  -H "Authorization: Bearer $(gh auth token)" --data-binary @-
```

Fill in `<NAME>`, `<origin>`, `<tenant id>` and `<host>`: `<NAME>` is the executor's `secret`; `<origin>` is its `url`'s scheme and host, with the port only when it isn't 443 (`https://api.anthropic.com` for a routine); `<tenant id>` is the tenant's `id` from `whoami`; `<host>` is the fab0 server's, `mcp.fab0.dev`, or the host of `FAB0_MCP_URL` when the person set one. Leave the value to the person's shell: the command reads it from their clipboard with `pbpaste` (on macOS), or they pipe in the output of another command that prints it, such as their password manager's. Never ask for the value, read it, or run the command yourself. If the person pastes a value into the conversation, don't repeat or use it, and tell them to make a new one, since this one was exposed. The person must be an admin of the tenant; GitHub's `/user` reads who they are from their token, which fab0 doesn't keep. The message says when the secret is set for another origin: the same command sets it for this one.

## 4. Put

Show the person the document, and say in a few lines what it does: what starts a run, what each step does and who or what works it, who decides each decision and where it leads, and what ends a run. Change it until they agree, validating again after each change (3).

Call `put_pipeline` with `text`, the whole file, and `tenant` when the person has several. Each valid document becomes its pipeline's active version; the answer gives each document's `status` and `version`. On `forbidden`, the person isn't an admin of the tenant: tell them an admin of a repository where fab0 is installed puts it, or merges it (6).

When the person keeps the file in a repository and wants its review there before it runs, don't put it: go to 6, where the merge and `sync_pipelines` put it.

## 5. Report

Report each warning by its `path`, not by its `line`: a store warning's line is its document's first line. Give the code, what it means from reference.md section 9, and what the person can do:

- `unbounded-wait`: a state may wait for ever. Ask whether a person always answers, or every child always ends; if not, add a `timeout`, handle it, and validate and put again.
- `unknown-pipeline`: the child pipeline isn't in the tenant yet. Write and put it too; until then, the step's `start_child` is refused.
- `secret-unset`: the executor at the path (`executors.<name>.secret`) has no secret set for its origin, so its steps fail with cause `refused` until the person sets it. Runs already started keep the version they began with; new runs use the one just put.

## 6. Commit

When the person keeps their pipelines in a repository, the file is its `.fab0/pipelines.yml`, read from the default branch. Commit it through a pull request:

1. Create a branch (`git switch -c pipelines/<name>`), commit only `.fab0/pipelines.yml`, and push the branch.
2. Open the pull request with `gh api -X POST repos/<owner>/<repo>/pulls -f head=<branch> -f base=<default branch> -f title=<title> -f body=<body>`, not `gh pr create`. The default branch is `gh api repos/<owner>/<repo> --jq .default_branch`, and the body says what the pipeline does, as you described it in 4. Show the person its link.
3. Once it is merged, call `sync_pipelines` with `repo` (`owner/name`), so fab0 reads the file now rather than at its next pass, within 15 minutes. It answers:
   - `synced`: each valid document is active; report its warnings as in 5;
   - `not-modified`: fab0 already had this file;
   - `absent`: the default branch has no `.fab0/pipelines.yml`: check that the merge landed;
   - `rejected`: the file was refused whole, and the active versions stay. Its `problems` say why: fix them on a new branch (3).

A pipeline put in 4 and the same text synced from the repository are one version: the sync changes nothing.
