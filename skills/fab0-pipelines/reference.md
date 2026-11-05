# fab0 pipeline reference

Everything a v2 pipeline can say, for the assistant that writes it. A pipeline is a state machine. fab0 holds each run's state, fires each step at an executor the pipeline names, and moves the run when a signal names a transition of its current state. fab0 decides nothing: a decision is a state that waits for a signal, and the pipeline says who or what may send it.

Write only what this reference describes. There is no other key, no expression language and no template.

## 1. The file

A pipelines file is a YAML stream, one pipeline per document, documents separated by `---`. Its first line is the modeline, so an editor checks the file against the published JSON Schema:

```yaml
# yaml-language-server: $schema=https://schema.fab0.dev/pipeline.v2.json
version: 2
name: first-pipeline
# ...
---
version: 2
name: second-pipeline
# ...
```

- **A pipeline's version** is the SHA-256 of its document's text. Editing one document changes only that pipeline's version. A run keeps the version it started with for its whole life; new runs take the active version.
- **Names are unique in the tenant** (the GitHub account that installed fab0), whichever file or repository a pipeline came from.
- **Two ways in, one store.** `put_pipeline` with the file's text, or the GitHub App's sync of `.fab0/pipelines.yml` in an installed repository's default branch (at installation, every 15 minutes, and at once with `sync_pipelines`). A valid document becomes its name's active version. An invalid one changes nothing.
- **Nothing is deleted by omission.** A file without a pipeline's document leaves that pipeline as it was.

Caps, per file:

| Cap | Value |
| --- | --- |
| file size | 1 MB |
| documents per file | 50 |
| one document | 128 KB |
| states per pipeline | 64 |
| executors per pipeline | 32 |
| transitions per state (counting each branch of a list) | 32 |
| `with` of one state, serialized | 8 KB |
| `outputs` of one state, serialized | 16 KB |
| `start` rules per pipeline | 16 |

## 2. Top-level keys

| Key | Required | Meaning |
| --- | --- | --- |
| `version` | yes | `2` |
| `name` | yes | unique in the tenant: `^[a-z][a-z0-9-]{0,62}$` |
| `description` | no | one line, at most 200 characters |
| `people` | no | groups for `by` lists: `group-name: [login, ...]`. A `by` list may mix group names and logins |
| `executors` | yes, may be `{}` | named executors (section 3) |
| `start` | no | how runs begin (section 7). Without it, the pipeline runs only as a child of another run |
| `limits` | no | `children`, `depth`, `visits` (section 8) |
| `states` | yes | the state machine (section 4). Its first key is the initial state |

## 3. Executors

An executor is where a state's step is sent. Its name is `^[a-z][a-z0-9-]{0,62}$`.

```yaml
executors:
  planner: { type: claude-routine, url: https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire, secret: PLANNER_TOKEN }
  checker: { type: http, url: https://ci.example.com/fab0, secret: CHECKER_HOOK }
  owner:   { type: manual, by: [octocat] }
```

| Type | Keys | What a fire does |
| --- | --- | --- |
| `claude-routine` | `url` (`https://api.anthropic.com/v1/claude_code/routines/trig_…/fire`), `secret` | starts a session of the person's Claude Code routine; the secret is the routine's token. The routine's saved prompt has it work the step with the `fab0-work` skill |
| `http` | `url` (`https://`, no user or password in it), `secret` | `POST <url>` with the secret as the bearer token; the client's own service does the step |
| `manual` | `by` (logins or `people` groups) | nothing is sent: the step waits in the `my_queue` of the people in `by`, one of whom claims and works it, usually with `fab0-work` |

- **A secret** is named, never written: `secret: NAME`, a name of `^[A-Z][A-Z0-9_]{0,63}$`. A tenant admin sets its value from their own shell with the secrets endpoint, for one origin (the scheme, host and port of the executor's `url`; `https://api.anthropic.com` for a routine). A fire is sent only to its secret's origin.
- A secret with no value, or set for another origin than the executor's, is the warning `secret-unset` when the pipeline is put. The pipeline is stored, but its fires to that executor fail with cause `refused` until the secret is set for that origin.
- **What a step does** comes from its state's `with` (section 4). A step worked by `fab0-work` reads `with.skill`, the name of a skill in the `.claude/skills/` of the repository where the step runs, or else `with.instructions`, plain text saying what to do.

## 4. States

A state name is `^[a-z][a-z0-9_-]{0,62}$`. The first state under `states` is where every run begins.

```yaml
states:
  planning:                       # the initial state: the first key
    run: planner                  # the executor fired on entry
    with: { skill: plan-feature } # passed to the step as written
    timeout: 2h                   # each attempt's deadline
    retries: 2                    # attempts after the first
    outputs:                      # JSON Schema that complete's outputs must satisfy
      type: object
      required: [summary]
      properties: { summary: { type: string } }
    on: { done: review, failed: stuck }
  review:
    on:
      approve: { to: building, by: [owners] }
      changes: planning
      reject: rejected
  building:
    run: planner
    children: { pipeline: part-delivery }
    on: { children.done: done, failed: stuck }
  stuck:
    timeout: 3d
    on: { retry: planning, abandon: rejected, timeout: rejected }
  done: { end: succeeded }
  rejected: { end: failed }
```

A state either fires a step (`run`), waits for signals (`on` only), or ends the run (`end`).

| Key | Meaning |
| --- | --- |
| `run` | an executor of this pipeline, fired on entry |
| `with` | an object passed to the step in its envelope, as written. No templates |
| `timeout` | a duration `^[1-9][0-9]*(s\|m\|h\|d)$`, from `10s` to `7d`. With `run`: each attempt's deadline, from its start; default `1h` for `http` and `claude-routine`, none for `manual`. Without `run`: the visit's deadline, after which the run receives `timeout`. With `children`: it also bounds the wait for the children, counted again from the step's `done` |
| `retries` | `0` to `10`, default `0`: attempts after the first, within one visit. Only with `run` |
| `outputs` | a JSON Schema (draft 2020-12) for `complete`'s outputs. Outputs that don't satisfy it fail the attempt with cause `invalid`. Accepted outputs are kept in the run's `data` under the state's name, and are the `done` signal's payload. Only with `run` |
| `children` | `true`, or `{ pipeline: <name> }` to restrict which pipeline the step may start as children. Only with `run`. Such a state emits no `done`: it waits for `children.done` |
| `on` | transitions (section 5) |
| `end` | `succeeded` or `failed`: entering the state ends the run. An `end` state has no other key |

- **Visits.** Entering a state starts a new visit, with fresh attempts. A loop back (`changes: planning`) is a new visit, and the step's envelope carries the visit number and the payload of the signal that entered it, so feedback travels with the loop. `limits.visits` caps visits per state.
- **Attempts.** A failed attempt with retries left starts the next attempt and emits nothing. With none left, the run receives `failed`, or `timeout` when the cause was the deadline and the state handles `timeout`.
- **Leaving a state** cancels its live attempt. A late `complete` from it is refused.

## 5. Transitions and signals

`on` maps a signal name to where it leads: a state name, a condition `{ to, where?, by? }`, or a list of conditions tried in order.

```yaml
on:
  done: next                                   # a state name
  approve: { to: building, by: [octocat] }     # with a condition
  github.pull_request_review.submitted:        # a list, tried in order; the first that holds wins
    - { where: { state: approved, sender: [octocat, hubot] }, to: building }
    - { where: { state: changes_requested }, to: planning }
```

A signal name is `^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$`, at most 64 characters. Three kinds:

| Kind | Names | Sent by |
| --- | --- | --- |
| engine | `done`, `failed`, `timeout`, `children.done` | fab0 |
| adapter | the `github.` signals of section 6 | the GitHub adapter, from a webhook delivery |
| client | any other name you choose (`approve`, `changes`, `retry`), not starting with `github.` or `fab0.` | people and agents, with the `signal` tool |

The engine's signals and their payloads:

| Signal | When | Payload |
| --- | --- | --- |
| `done` | an attempt's `complete` is accepted | its outputs |
| `failed` | the last attempt of a visit fails | `{ cause, reason }`; `cause` is `failed` (the step called `fail`), `invalid` (outputs didn't satisfy `outputs`), `timeout`, `refused` (the executor refused the fire) or `unknown` (no answer) |
| `timeout` | a state without `run` reaches its `timeout`; or the last attempt fails by its deadline and the state handles `timeout` | `{}`, or `{ cause: "timeout", reason }` |
| `children.done` | the visit's step is done and every child it started has ended | `{ succeeded, failed, cancelled }`, counts |

- **`where`** is equality on top-level payload fields. Each value is a string, number, boolean or `null`, or a list of them, any of which may match. A field the payload lacks matches nothing. Branch on a step's result by giving its `outputs` a field to test: `- { where: { verdict: approve }, to: merge }`.
- **`by`** names logins or `people` groups. A client signal counts only from a person in it. On an adapter signal, `by` is matched against its `sender`. `by` is not allowed on an engine signal.
- **Without `by`**, a client signal is taken from any member of the tenant, and an adapter signal from any sender, bots included. `where: { sender_type: User }` keeps only people.
- **A signal that holds no transition** in the current state, or matches no condition of its list, is ignored and recorded with the reason (`get_run` shows it). It never moves the run. So a late or stray signal is harmless.

## 6. GitHub signals and their fields

The GitHub adapter turns a webhook delivery into a signal named `github.<event>.<action>`, with a flat payload of the fields below. No field holds text a person wrote: no title, body, comment, review text or commit message. fab0 only reads GitHub; it never writes to it.

These are the only `github.` signals. The adapter sends no other, so a pipeline can't wait for issue assignment or an edit of a pull request's text.

| Signal | Its own fields |
| --- | --- |
| `github.issues.opened` | `state`, `state_reason`, `issue_type` |
| `github.issues.labeled` | `state`, `state_reason`, `issue_type`, `label` |
| `github.issues.unlabeled` | `state`, `state_reason`, `issue_type`, `label` |
| `github.issues.typed` | `state`, `state_reason`, `issue_type` |
| `github.issues.untyped` | `state`, `state_reason`, `issue_type` |
| `github.issues.closed` | `state`, `state_reason`, `issue_type` |
| `github.issues.reopened` | `state`, `state_reason`, `issue_type` |
| `github.issues.transferred` | `state`, `state_reason`, `issue_type`, `moved_to` |
| `github.issues.deleted` | `state`, `state_reason`, `issue_type` |
| `github.issue_comment.created` | `pull_request` |
| `github.sub_issues.sub_issue_added` | `sub_issue` |
| `github.sub_issues.sub_issue_removed` | `sub_issue` |
| `github.issue_dependencies.blocked_by_added` | `blocker` |
| `github.issue_dependencies.blocked_by_removed` | `blocker` |
| `github.pull_request.opened` | `state`, `merged`, `draft`, `head_sha`, `base` |
| `github.pull_request.closed` | `state`, `merged`, `draft`, `head_sha`, `base` |
| `github.pull_request.reopened` | `state`, `merged`, `draft`, `head_sha`, `base` |
| `github.pull_request.synchronize` | `state`, `merged`, `draft`, `head_sha`, `base` |
| `github.pull_request.ready_for_review` | `state`, `merged`, `draft`, `head_sha`, `base` |
| `github.pull_request_review.submitted` | `state`, `head_sha` |
| `github.pull_request_review.dismissed` | `state`, `head_sha` |

Every signal also has the five common fields, which are never `null`:

| Field | Type | Value |
| --- | --- | --- |
| `key` | string | the object the event is about, `github:<owner>/<repo>#<number>`, lower case. It routes the signal |
| `repo` | string | `<owner>/<repo>`, lower case |
| `number` | number | the issue's or pull request's number |
| `sender` | string | the login of the account that caused the event, lower case |
| `sender_type` | string | `User`, `Bot` or `Organization` |

The events' own fields, any of which is `null` when the delivery lacks it:

| Field | Type | Value |
| --- | --- | --- |
| `state` | string | on issues and pull requests, `open` or `closed`. On reviews, `approved`, `changes_requested`, `commented` or `dismissed` |
| `state_reason` | string | `completed`, `not_planned`, `duplicate`, `reopened`, or `null` |
| `issue_type` | string | the issue type's name, as GitHub shows it (`Feature`, `Bug`), or `null` when it has none. Carried by every `github.issues.` signal, `labeled` included |
| `label` | string | the label's name, as GitHub shows it |
| `moved_to` | string | the transferred issue's new key |
| `pull_request` | boolean | `true` when the comment is on a pull request |
| `sub_issue` | string | the sub-issue's key; `key` is the parent's |
| `blocker` | string | the blocking issue's key; `key` is the blocked issue's |
| `merged` | boolean | `true` once merged. A merge is `github.pull_request.closed` with `merged: true` |
| `draft` | boolean | whether the pull request is a draft |
| `head_sha` | string | the head commit's SHA, or the commit a review is on |
| `base` | string | the base branch's name |

A string field is at most 255 characters.

- **Case.** `key`, `repo`, `sender`, `moved_to`, `sub_issue` and `blocker` are lower case, and fab0 lower-cases what a `where` gives them, so `sender: OctoCat` matches. `label`, `issue_type` and every other value are compared as written: `label: Ready` doesn't match `ready`.
- **Common patterns.** An approval by a person: `github.pull_request_review.submitted` with `where: { state: approved }` and `by: [login]`. A merge: `github.pull_request.closed` with `where: { merged: true }`; its `sender` is whoever merged it. A closed issue: `github.issues.closed`, with `state_reason` to tell done from not planned.
- **An author can't review their own pull request.** A routine acts as its owner, so when a routine opens the pull request, the owner's decision on it reaches the run as a client signal (`changes`) or as the merge, not as a review.

### How a GitHub signal reaches a run

- **To the run that holds its key.** A run holds its subject (the key it was started with) and every key a step linked to it. An active run that holds the signal's `key` receives the signal. A key belongs to at most one active run.
- **Or it starts a run** of a pipeline whose `start` rule matches (section 7), with the key as the new run's subject.
- **Or it goes nowhere.** Nothing catches up later, and fab0 never reads GitHub to recover a missed event.

So a run that waits for a pull request's review or merge needs that pull request's key linked first. `fab0-work` links what a step makes, such as the pull request it opens, before the run waits on it. A step that doesn't use `fab0-work` calls `link` itself. Never wait on an object's events without a step that links it, unless it is the run's subject.

## 7. `start`

```yaml
start:
  - on: api                                    # start_run, by a person or agent
  - on: github.issues.labeled                  # a GitHub signal of section 6
    where: { label: Ready, issue_type: Feature }
```

- **`on: api`** lets `start_run` start the pipeline, with an optional subject and input. A pipeline that people should also start by hand lists it beside its GitHub rules.
- **`on: <github signal>`** starts a run when a delivery of that name arrives whose key no active run holds, and whose fields satisfy `where`. The run's subject is the delivery's key, its first step's input is the fields, and its entry signal is the rule's name.
- A start rule has no `by`. Name who may trigger it with `where: { sender: [login, ...] }`.
- A delivery starts at most one run: pipelines are tried in name order, and the first start takes the key.
- A pipeline without `start` runs only as a child, started by a step of a state with `children`.

## 8. Limits

| Key | Default | Cap | Meaning |
| --- | --- | --- | --- |
| `limits.children` | 20 | 500 | child runs a run may start over its life |
| `limits.depth` | 2 | 5 | how deep runs started from this pipeline may nest; the root is depth 0. Read from the root run's pipeline |
| `limits.visits` | 10 | 100 | visits per state in one run. A transition past the cap is ignored, and the run stays where it is |

## 9. Validation codes

`validate_pipeline` with `text` answers the file's `problems` (a YAML error or a file cap, which stop every document) and, for each document, its `errors`, which make that pipeline invalid, and its `warnings`, which don't. Each problem has a `code`, its document and pipeline `name`, a `path` to the offending key, a `line`, a `message` and a `fix`. Apply the fix at the path. `put_pipeline` and the file sync add the `store` warnings, which check a document against what the tenant holds; their `line` is the document's first line, so read their `path`.

| Code | Kind | What it means | Fix |
| --- | --- | --- | --- |
| `schema` | error | the document doesn't match the schema: a missing or unknown key, a wrong type, a bad name; or the file isn't YAML. Where a value may take several shapes, the message names the closest | follow the path: add the missing key, remove the unknown one, or correct the value. For YAML, fix the syntax at the line |
| `file-cap` | error | a cap of section 1 is exceeded | split a pipeline that does two jobs, or use a child pipeline |
| `duplicate-name` | error | two documents share a `name` | rename one: `name` identifies a pipeline across versions |
| `unknown-state` | error | a transition's `to` names no state | name a state under `states`, or add it |
| `unreachable-state` | error | no path of transitions leads from the initial state to this one | add a transition that leads to it, or remove it |
| `dead-end` | error | a state is neither `end` nor has any transition out | add a transition, or make it an `end` state |
| `unhandled-step` | error | a state with `run` handles neither `done` nor `failed` | add `done:` and `failed:` transitions |
| `unknown-executor` | error | `run` names no executor | add it under `executors`, or name one there |
| `step-keys` | error | `retries`, `outputs` or `children` on a state without `run` | add `run`, or remove the key |
| `children-unhandled` | error | a state with `children` doesn't handle `children.done` | add `children.done:` to its `on` |
| `timeout-unhandled` | error | a state without `run`, or with `children`, has `timeout` but doesn't handle `timeout` | add `timeout:` to its `on`, or remove `timeout` |
| `unknown-person` | error | a `by` entry is neither a `people` group nor a login (`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`) | add the group under `people`, or write the login |
| `by-on-engine-signal` | error | `by` on `done`, `failed`, `timeout` or `children.done` | remove `by`: fab0 sends these. Branch with `where` on their payload instead |
| `reserved-signal` | error | an `on` key starts with `fab0.` | choose another name |
| `start-source` | error | a `start` rule's `on` is neither `api` nor a GitHub signal | use `on: api`, or a signal of section 6 |
| `adapter-signal` | error | a `github.` name in `start` or `on` that the adapter doesn't send | use one of the signals the fix lists |
| `adapter-field` | error | a `where` field that the GitHub signal doesn't carry | use one of the fields the fix lists |
| `outputs-schema` | error | `outputs` isn't a valid JSON Schema, or can't be built: two subschemas with the same `$id`, or a `$ref` that doesn't resolve inside it (no schema is fetched) | correct it; `type: object` with `properties` is enough |
| `limit-cap` | error | a limit or duration outside its range | use a value within section 4's or 8's range |
| `unknown-pipeline` | warning (store) | `children.pipeline` names no pipeline in the file or the tenant | put that pipeline too; until then the step's `start_child` is refused |
| `secret-unset` | warning (store) | an `http` or `claude-routine` executor's `secret` has no value in the tenant, or is set for another origin than the executor's `url`, which the message names. Its path is `executors.<name>.secret` | the person sets it with the secrets endpoint, from their own shell (section 3) |
| `unbounded-wait` | warning | a state with `children` and no `timeout`; or a state without `run` and without `timeout` whose every transition has `by` | none, if a person always answers or every child always ends; otherwise add a `timeout` and handle it |

## 10. Whole pipelines

Each of these validates with no error. Replace every login and name with the person's own.

A step, a person's decision, and a loop back on changes:

```yaml
# yaml-language-server: $schema=https://schema.fab0.dev/pipeline.v2.json
version: 2
name: review-loop
description: One step, reviewed by a person, redone on changes.
people: { reviewers: [octocat] }
executors:
  worker: { type: manual, by: [octocat] }
start: [{ on: api }]
limits: { visits: 5 }
states:
  work:
    run: worker
    retries: 1
    outputs: { type: object, required: [summary], properties: { summary: { type: string } } }
    on: { done: review, failed: abandoned }
  review:
    timeout: 7d
    on:
      approve: { to: done, by: [reviewers] }
      changes: { to: work, by: [reviewers] }
      reject: { to: abandoned, by: [reviewers] }
      timeout: abandoned
  done: { end: succeeded }
  abandoned: { end: failed }
```

An issue labelled `Ready` worked into a pull request by a routine, reviewed on GitHub by a person, and merged. The step links the pull request it opens, so the review and the merge reach the run:

```yaml
version: 2
name: issue-to-merge
description: An issue labelled Ready is worked into a pull request, reviewed on GitHub, and merged.
people: { reviewers: [octocat] }
executors:
  builder: { type: claude-routine, url: https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire, secret: BUILDER_TOKEN }
start:
  - on: github.issues.labeled
    where: { label: Ready, sender_type: User }
  - on: api
limits: { visits: 5 }
states:
  build:
    run: builder
    with: { skill: implement }
    timeout: 3h
    retries: 1
    outputs: { type: object, required: [pr], properties: { pr: { type: string } } }
    on: { done: review, failed: stuck }
  review:
    timeout: 7d
    on:
      github.pull_request_review.submitted:
        - { where: { state: approved }, by: [reviewers], to: merge }
        - { where: { state: changes_requested }, by: [reviewers], to: build }
      github.issues.closed: abandoned
      timeout: stuck
  merge:
    timeout: 7d
    on:
      github.pull_request.closed:
        - { where: { merged: true }, to: done }
        - { to: stuck }
      timeout: stuck
  stuck:
    timeout: 7d
    on:
      retry: { to: build, by: [reviewers] }
      abandon: { to: abandoned, by: [reviewers] }
      timeout: abandoned
  done: { end: succeeded }
  abandoned: { end: failed }
```

A parent whose step starts children, and the child pipeline, in one file:

```yaml
version: 2
name: fan-out
description: A plan cut into parts, each run as a child, then accepted by a person.
people: { owners: [octocat] }
executors:
  planner: { type: manual, by: [octocat] }
start: [{ on: api }]
limits: { children: 10, depth: 1 }
states:
  plan:
    run: planner
    children: { pipeline: fan-out-part }
    timeout: 7d
    on: { children.done: accept, failed: abandoned, timeout: abandoned }
  accept:
    timeout: 7d
    on:
      approve: { to: done, by: [owners] }
      redo: { to: plan, by: [owners] }
      reject: { to: abandoned, by: [owners] }
      timeout: abandoned
  done: { end: succeeded }
  abandoned: { end: failed }
---
version: 2
name: fan-out-part
description: One part of a fan-out, done by a person.
executors:
  worker: { type: manual, by: [octocat] }
states:
  work:
    run: worker
    on: { done: done, failed: failed }
  done: { end: succeeded }
  failed: { end: failed }
```
