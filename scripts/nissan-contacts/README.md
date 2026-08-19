# nissan-contacts — where the contact map comes from

These two scripts produce the raw facts behind [`/nissan-contacts`](../../public/nissan-contacts.html).
The page itself is hand-written HTML: the scripts tell you **who exists, what
their signature says and which systems they show up in**, and a human decides
how to group and word that. Re-run them when the page starts to feel stale.

```bash
cd scripts/nissan-contacts
./fetch-emails.sh                 # 2026-03 .. this month, into ./out/
python3 extract-contacts.py       # report to stdout
python3 extract-contacts.py --json  # ./out/contacts.json
```

The first run of `fetch-emails.sh` on ~700 messages takes a few minutes; both
steps are resumable — anything already in `out/` is skipped.

## How it reads the mailbox

`nissan-ma@muze.co.th` is read through the **deployed portal's own digest
endpoints**, authenticated with `x-digest-secret` (the `DIGEST_SECRET` in the
repo `.env`):

| endpoint | used for |
| --- | --- |
| `GET /api/digest/range?account=&from=&to=` | live Gmail query, one call per month → msgId, subject, sender display name, date, snippet |
| `GET /api/digest/email-body?account=&msgId=` | the full body of one message |

A local script cannot talk to Gmail directly. The mailbox refresh tokens live
in the admin account's Drive appDataFolder and are unlocked by
`GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET` and
`DRIVE_ADMIN_REFRESH_TOKEN`, none of which exist outside the Vercel
environment — so the deployed app is the only thing holding the keys.

The bodies are the interesting half. `range` strips `<address>` out of the
`From` header, but every reply quotes the full `From: / To: / Cc:` block and
the sender's signature, so parsing bodies reconstructs the whole distribution
list along with job titles and phone numbers.

Point it at another mailbox with `ACCOUNT=support-tvn@muze.co.th ./fetch-emails.sh`
(valid values: `support@`, `support-mea@`, `support-tvn@`, `nissan-ma@`,
`ktc@muze.co.th`).

## SIG vs INF

The page badges every person with where their description came from, and
`extract-contacts.py` keeps the two apart deliberately:

- **SIG** — the title, department or phone number appears verbatim in that
  person's own signature block, in the newest part of a message they sent.
  Safe to quote.
- **INF** — inferred from what they do in threads, plus which systems their
  address co-occurs with. A twenty-person Cc chain lifts everyone's score
  equally, so this is good for grouping and useless as a job title. Check
  before relying on it.
- **DL** — a shared mailbox or distribution list, not a person.

## Don't commit `out/`

It is gitignored, and should stay that way. The fetched bodies are real support
threads: customer names, phone numbers, licence plates, VINs and addresses.
Nothing in `out/` belongs in git, in a ticket, or in a chat message.
