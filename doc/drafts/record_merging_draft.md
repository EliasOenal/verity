# Record merging draft document

## Technical requirements
1. Applications need a way to concurrently store and update data from multiple
   clients.
1. Clients manipulating the data may belong to
  - the same user (e.g. multiple devices using the same account, like a user
    being online on both their phoneand notebook); in this case, concurrent
    access is trusted and all writing clients possess the same keys.
  - or different users, which may or may not possess shared keys.

## Example applications requiring these features
### Identity module / User accounts
Our reference Identity module required these feature to reliably support
concurrent access from the same user across multiple devices.

Support for the requested features is required in the following use cases:

#### Easier use cases
These use cases only require conflict-free merging.

- User adds information on both devices, e.g. makes a new post on each device
- User edits different records on both devices, e.g. changes their screen name
  on one device and their avatar on the other.
- User performs any write on one device without being able to first fetch the
  other devices state
  - For example, a user who only ever has used their phone now logs onto Verity
    on their notebook for the first time. However, the notebook is offline:
    This still allows the user to "log in" as key derivation is local, but the
    notebook cannot fetch the Identity MUC. If the user now performs any write,
    e.g. makes a post, this will delete all past content until we implement
    record merging.

#### Harder use cases
These use cases require conflict resolution.

- User adds a record, then deletes it again on the same device;
  e.g. makes a post, then changes their mind and deletes it again.
  - The challenge here is to differentiate a deleted record from one that has
    just not propagated yet. A simple Lamport clock can solve this.
- User adds a record on one devices, then deletes it on another.
  - Lamport clock will still be able to solve this as the record can only
    be deleted once it has propagated.
- User edits the same record on both devices, e.g. changes their screen name
  to different values on both devices.
  - This case may be unsolvable; we may have to clear it by random draw or by
    considering unreliable information such as timestamps.

### Generic database applications
Providing a native way of storing and updating versioned records allows
applications to use Verity in a way similar to a basic distributed database.

## Existing primitives
- MUCs allow concurrent access by the same user or users with shared keys, but:
  - No notion of semantic versioning;
    newest timestamp wins, and timestamps are not synchronised (i.e.
    greater timestamp does not guarantee newest version)
  - No notion of conflict resolution; largest timestamp wins.
  - No concept of records, MUC is always updated as a whole.
    (thus unsuitable for a large number of small records)
- PMUCs allow semantic versioning through the update count (which can be used
  as a Lamport clock), but otherwise suffer the same problems as MUCs.

## Theoretical background
- This problem is somewhat similar to the readers-writers problem in concurrent
  computing -- but with no but with no central hardware available to resolve it.
- It's very similar to concurrency control in distributed databases --
  but with a potentially unknown and unlimited number of instances, making
  two-phase commit impossible.

## Possible solutions
### Merge-and-publish using local Redo Logs
As before, there is single mainline MUC published on the network.
Writing clients are responsible for performing a merge before they publish any
updates.

#### Advantages
- Readers only need to fetch the mainline MUC.
- Less space consumed on the network as logs remain local.
- No need to announce client MUCs somehow/somewhere, as there are none.
- Scales well in theory as the merging algorithm remains the same regardless of
  the number of clients.

#### Disadvantages
- Publishers must constantly monitor the network for any of their changes
  getting overwritten and remerge/republish if necessary.
- Large risk of publishing loops ("edit wars"),
  both as in large risk of this occurring and as in huge impact for both the
  user and the network when it occurs.

### Recipient-side merge using separate MUCs for each client
"Everybody does their own merge": There is no master/mainline MUC.
A client wanting to read any record must fetch all device MUCs and first perform
their own, local merge.

#### Advantages
- Easier to implement as each client can just publish changes and be done with it,
  no need to check the network for unmerged changes, no need for republishing.
- Less error-prone, especially in case of unstable or split networks.

#### Disavantages
- Does not scale well in case of large number of clients.
  Every time a user logs in on a shared device, deletes their browser cookies or
  just opens a new incognito tab should end up triggiering a separate client
  MUC that would, in its most primitive approach, linger around forever.
- How to announce the client MUCs in the first place?
  We could implement a separate WORM-type merging primitive and track client
  MUCs in an append-only list, but that just exacerbates the scaling problem
  in case of a large number of clients.
