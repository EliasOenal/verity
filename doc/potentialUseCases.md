As Verity gladly 'does not implement a cryptocurrency nor does it resemble a
blockchain', it relieves as us of asking the stereotipical question:
*I have a blockchain, now what can I use it for?*

But still, let's collect some ideas:

- Microblogging
- Collection of billing data, e.g. from smart meters
- LoRa access point
- Storage of survey results, e.g. Diary Studies
- Direct messaging (like email/PM)
- Imageboards (linking to external content)
- Decentralized subscriptions/feeds (e.g. Youtube, Odysee, BitChute)
- Closed forums
- Wiki
- P2P Marketplace
- Personal Blogs
- Short term static HTML hosting
- Secure Drop Zones
- Decentralized Dead Man’s Switch (Application layer service implementing Shamir's secret sharing)
- IoT secure firmware updates
- Chat (Anonymous, Pseudonymous)
- Pastebin
- Usenet
- JS library to implement guestbooks/chats on static websites
- Firebase alternative
- Replicated file storage (need to optimise code and probably run a separate network with larger Cube sizes for this to make sense)

## User growth strategies
### Microblogging
- Local community niches: Try to get a partnership with a local content provider
  and either an existing local community or a local authority, e.g. in Malta:
  concince MaltaToday to provide local news and MTA to let us post Verity QR codes
  in touristy areas, hotels, brochures, etc.
- Private communities, e.g. for a company (or department or team), school
  (or class or course), club or activist group.
  Can be made cheaper and easier to set up than commercial or server-based
  alternatives, especially if we don't require them to set up their own full nodes.
  Cons: Consumes resources on our full nodes without providing much in return
  and does not help the public microblogging app in terms of content.

### Application backend
i.e. how to build a developer base building applications on top of Verity

- Become a supported backend on "no code" AI application generators

## Monetarisation strategies:

### Microblogging
We could try the usual combination of ads, paid featured posts, paid user
verification; but I'm not too confident in any of them, and all of them basically
defeat the purpose of a decentralised network.

### Billing data / LoRa access point / General application backend
- Sell keys to users, allow a certain amount of zero-hashcash Cubes per key
  (positions us as a resilient alternative to AWS and all the other cloud
  providers, but impossible to beat them on price for the miniscule amount of
  data we offer, and hard to convince users we're a safer choice than Amazon)
- Sell keys to IoT device makers, allow them a certain amount of zero-hashcash
  Cubes per key.
