---
"@tdreyno/he-said": minor
---

Add `resourceType()` — first-class resource type declarations (FR-22)

Introduces `resourceType<T>(options)` as a unified object that replaces the parallel maps adopters previously maintained per resource type. Each `ResourceType` bundles its algebra term, backing table/key metadata, optional composite-key context terms, and ownership path into a single declaration.

**New API** (`@tdreyno/he-said/rebac`):

```ts
import { resourceType } from "@tdreyno/he-said/rebac"

const File = resourceType<{ id: string }, Team>({
  table: "files",
  key: "id",
  owner: either(through(fileInProject, projectInTeam), through(fileInTeam)),
})

// Standalone helpers — no policy needed:
File.exists()           // existence Rule (wraps core exists())
File.ownedBy(teamTerm)  // ownership Rule
File.bind({ id: "f1" }) // Environment fragment for evaluate()
```

`scopedPolicy` now accepts `ResourceType` objects directly in `resources` (still fully backwards-compatible with bare `ScopePath`):

```ts
const policy = scopedPolicy({
  resources: { File },                             // ResourceType IS the config
  bypass: ({ resource }) => and(factIsTrue(isAppAdmin), resource.exists()), // FR-18
  ...
})
```

- `bypass` is an optional policy-level function that is OR'd with the normal rule for each `ResourceType` resource, enabling admin bypasses without per-action overrides.
- `can()` automatically extracts context-term bindings via `bind()` when the resource entry is a `ResourceType`.
- `ResourceType.term` is the canonical term symbol — identical to `policy.resourceTerms[key]`, so rules built outside the policy stay compatible.
