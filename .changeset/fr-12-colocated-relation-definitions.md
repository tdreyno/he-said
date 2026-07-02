---
"@tdreyno/he-said": minor
---

feat: colocated relation definitions

`relation<Left, Right>()` now accepts an optional `pairs` argument so you can
define relation data alongside the relation itself:

```ts
const userOwnsDocument = relation<User, Document>([
  [u1, d1],
  [u2, d1],
])
```

`createInMemoryAdapter` accepts `Relation` objects directly in the `relations`
array (in addition to the existing `InMemoryRelationFacts` shape), using the
colocated pairs automatically:

```ts
createInMemoryAdapter({
  relations: [userOwnsDocument],
  domain: [u1, u2, d1],
})
```

Both styles can be mixed freely in a single adapter instance.
