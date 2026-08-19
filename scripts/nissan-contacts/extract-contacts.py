#!/usr/bin/env python3
"""Turns the fetched nissan-ma bodies into the contact facts behind
public/nissan-contacts.html.

Run ./fetch-emails.sh first, then:

    python3 extract-contacts.py            # human-readable report to stdout
    python3 extract-contacts.py --json     # machine-readable dump to out/contacts.json

Nothing here invents a role. Two things are extracted and kept apart, because
the page shows the difference as a SIG / INF badge:

  * SIG-grade - a job title, department or phone number that literally appears
    in the sender's own signature block (the lines after the last sign-off in
    the newest part of a message).
  * INF-grade - who talks about which system, derived from co-occurrence only.
    Useful for grouping, never good enough to quote as someone's job title.
"""

import argparse
import glob
import json
import os
import re
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')

EMAIL_RE = re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}')
# "Name <a@b.com>", "Name [mailto:a@b.com]", "Name (a@b.com)"
NAMED_RE = re.compile(
    r'([^<>;,\n\r\[\]\(\)"]{2,60}?)\s*[<\[\(](?:mailto:)?'
    r'([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})[>\]\)]')
HEADER_PREFIX = re.compile(r'^(From|To|Cc|Bcc|Sent|Subject|Date|จาก|ถึง)\s*:\s*', re.I)

# Machine-generated addresses that would otherwise dominate the ranking.
NOISE_DOMAINS = re.compile(r'^(01d[0-9a-f]{4}|.*\.outlook\.com|mail\.gmail\.com)')

# Where someone else's message starts. Thai Gmail/Outlook use their own
# markers ("ในวันที่ ... เขียนว่า:", "ข้อความที่ส่งต่อ", "ส่ง:"), and missing them
# is what makes a forwarded signature look like the sender's own.
QUOTE_START = re.compile(
    r'^\s*[>\*]*\s*(?:'
    r'(?:From|Sent|To|Cc|On .{5,60}wrote:|-----Original|-+ ?Forwarded message|Date:)\b'
    r'|_{5,}|จาก\s*:|ส่ง\s*:|ในวันที่|-+ ?ข้อความที่ส่งต่อ'
    r')', re.I)
SIGN_OFF = re.compile(
    r'(best regards|kind regards|thanks and regards|regards|thank you|'
    r'ขอบคุณ|ขอแสดงความนับถือ|sincerely|br,|thanks,)', re.I)
TITLE_RE = re.compile(
    r'(Manager|Director|Supervisor|Engineer|Analyst|Specialist|Officer|Consultant|'
    r'Lead|Executive|Coordinator|Administrator|Developer|Architect|Owner|Staff|'
    r'Chief|President|Department|Division|Section|Team Leader|Head of|Co\.,? ?Ltd)', re.I)
TEL_RE = re.compile(r'(?:Tel|Mobile|Phone|โทร|P:|M:)[^\n]{0,40}?((?:\+?66|0)[\d\-\s\(\)]{7,20})', re.I)

# Systems worth attributing. Keep these in sync with the ROUTES table on the page.
SYSTEMS = {
    'MyNISSAN App': r'my ?nissan|มายนิสสัน',
    'Service Desk (NMT)': r'ticket id|service ?desk',
    'CRM / CDP': r'\bCRM\b|\bCDP\b',
    'DMS': r'\bDMS\b',
    'Aftersales LMS': r'\bLMS\b|social command',
    'SSI/CSI Survey': r'\bSSI\b|\bCSI\b',
    'Nissan Leasing': r'nissanleasing|leasing',
    'AWS / Infra': r'\bAWS\b|secrets manager|\bEKS\b|circleci|vault',
    'Website / Security': r'next\.?js|vulnerab',
    'Recall': r'recall',
    'Service History': r'service history|ประวัติการเข้ารับบริการ',
    'Store / Release': r'app ?store|play ?store|apple developer|firebase|crashlytics',
    'Jira MN board': r'jira|MN-\d+',
}


def load_bodies():
    """Yields (msgId, body) for every fetched message that has text."""
    for path in sorted(glob.glob(os.path.join(OUT, 'bodies', '*.json'))):
        try:
            body = json.load(open(path)).get('body') or ''
        except (ValueError, OSError):
            continue
        if body:
            yield os.path.basename(path)[:-5], body


def load_senders():
    """msgId -> sender display name, from the month listings."""
    senders = {}
    for f in glob.glob(os.path.join(OUT, 'range_*.json')):
        for acc in json.load(open(f)).get('counts', {}).values():
            for e in acc['emails']:
                senders[e['msgId']] = e['from']
    return senders


def collect_addresses(bodies):
    """email -> {count, name}. Name is the display name seen most often."""
    freq = Counter()
    names = defaultdict(Counter)
    for _, body in bodies:
        for addr in EMAIL_RE.findall(body):
            addr = addr.lower()
            if not NOISE_DOMAINS.match(addr.split('@')[1]):
                freq[addr] += 1
        for name, addr in NAMED_RE.findall(body):
            name = HEADER_PREFIX.sub('', name.strip().strip('"')).strip()
            if name and '@' not in name and len(name) > 2:
                names[addr.lower()][name] += 1
    return {
        addr: {
            'count': count,
            'domain': addr.split('@')[1],
            'name': names[addr].most_common(1)[0][0] if names[addr] else '',
        }
        for addr, count in freq.most_common()
    }


def collect_signatures(bodies, addresses, senders):
    """SIG-grade facts: title lines and phone numbers from the sender's own
    signature. Only the newest part of each message is read - anything below
    the first quoted header belongs to someone else."""
    by_name = {}
    for addr, meta in addresses.items():
        key = re.sub(r'[^A-Za-z]', '', meta['name']).upper()
        if len(key) > 5:
            by_name.setdefault(key, addr)

    titles = defaultdict(Counter)
    phones = defaultdict(Counter)
    for msg_id, body in bodies:
        addr = by_name.get(re.sub(r'[^A-Za-z]', '', senders.get(msg_id, '')).upper())
        if not addr:
            continue
        top = []
        for line in body.splitlines():
            if QUOTE_START.match(line):
                break
            top.append(line.rstrip())

        last_signoff = None
        for i, line in enumerate(top):
            if SIGN_OFF.search(line) and len(line) < 60:
                last_signoff = i
        if last_signoff is None:
            continue

        window = [l for l in top[last_signoff + 1:last_signoff + 12]
                  if not l.lstrip().startswith('>')]

        # A forward pasted inline carries no quote marker at all, so the block
        # under "Best Regards," can belong to whoever was forwarded. If the
        # block names an address other than the sender's, it is not their
        # signature - drop it rather than mislabel someone's job title.
        # "E-mail.anusa.tho@nissan.co.th" and cid image ids both parse as
        # addresses, so ignore machine ids and match the sender's address as a
        # suffix rather than exactly.
        foreign = [
            a.lower() for l in window for a in EMAIL_RE.findall(l)
            if not NOISE_DOMAINS.match(a.lower().split('@')[1])
            and not a.lower().endswith(addr)
        ]
        if foreign:
            continue

        for line in window:
            s = line.strip().strip('*|_').strip()
            if not (3 < len(s) < 90) or 'http' in s.lower():
                continue
            if TITLE_RE.search(s) and '@' not in s:
                titles[addr][s] += 1
            tel = TEL_RE.search(s)
            if tel:
                phones[addr][tel.group(1).strip()] += 1
    return titles, phones


def collect_systems(bodies):
    """INF-grade: which systems each address shows up alongside. A long Cc
    chain inflates everyone equally, so read this as 'is in that conversation',
    not 'owns that system'."""
    totals = Counter()
    per_addr = defaultdict(Counter)
    for _, body in bodies:
        present = [name for name, pat in SYSTEMS.items() if re.search(pat, body, re.I)]
        for name in present:
            totals[name] += 1
        for addr in set(EMAIL_RE.findall(body)):
            for name in present:
                per_addr[addr.lower()][name] += 1
    return totals, per_addr


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--json', action='store_true', help='write out/contacts.json instead of a report')
    parser.add_argument('--min-count', type=int, default=20,
                        help='ignore addresses mentioned fewer than this many times (default 20)')
    args = parser.parse_args()

    bodies = list(load_bodies())
    if not bodies:
        raise SystemExit(f'no bodies in {OUT}/bodies - run ./fetch-emails.sh first')
    senders = load_senders()

    addresses = collect_addresses(bodies)
    titles, phones = collect_signatures(bodies, addresses, senders)
    sys_totals, sys_per_addr = collect_systems(bodies)

    kept = {a: m for a, m in addresses.items() if m['count'] >= args.min_count}

    if args.json:
        dump = {
            'messages': len(bodies),
            'systems': dict(sys_totals.most_common()),
            'contacts': [
                {
                    'email': addr,
                    'name': meta['name'],
                    'domain': meta['domain'],
                    'mentions': meta['count'],
                    'titles': [t for t, _ in titles[addr].most_common(4)],
                    'phones': [p for p, _ in phones[addr].most_common(2)],
                    'systems': [s for s, _ in sys_per_addr[addr].most_common(5)],
                }
                for addr, meta in kept.items()
            ],
        }
        path = os.path.join(OUT, 'contacts.json')
        json.dump(dump, open(path, 'w'), ensure_ascii=False, indent=1)
        print(f'{len(dump["contacts"])} contacts -> {path}')
        return

    print(f'=== {len(bodies)} messages, {len(addresses)} addresses '
          f'({len(kept)} with >= {args.min_count} mentions) ===\n')

    print('--- organisations by address count ---')
    domains = Counter(m['domain'] for m in addresses.values())
    for domain, n in domains.most_common(20):
        mentions = sum(m['count'] for m in addresses.values() if m['domain'] == domain)
        print(f'{n:4d} addrs {mentions:7d} mentions  {domain}')

    print('\n--- confirmed titles and phones (SIG-grade) ---')
    for addr, meta in kept.items():
        if titles[addr] or phones[addr]:
            title = ' / '.join(t for t, _ in titles[addr].most_common(3))
            tel = ', '.join(p for p, _ in phones[addr].most_common(2))
            print(f'{addr:46s} {meta["name"][:26]:26s} | {title[:90]:90s} | {tel}')

    print('\n--- systems by volume ---')
    for name, n in sys_totals.most_common():
        print(f'{n:5d}  {name}')

    print('\n--- who appears alongside which systems (INF-grade, co-occurrence only) ---')
    for addr, meta in kept.items():
        if sys_per_addr[addr]:
            top = '; '.join(f'{s}({n})' for s, n in sys_per_addr[addr].most_common(5))
            print(f'{addr:46s} | {top}')


if __name__ == '__main__':
    main()
