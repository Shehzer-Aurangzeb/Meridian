"""Minimal PDF text extractor: resolves per-page font resources to ToUnicode
CMaps so subset-font hex strings decode correctly. Enough for this one doc."""
import zlib, re, sys

path = sys.argv[1]
d = open(path, 'rb').read()

# ── object table ───────────────────────────────────────────────────────────
objs = {}
for m in re.finditer(rb'(\d+)\s+0\s+obj\b', d):
    num = int(m.group(1))
    end = d.find(b'endobj', m.end())
    objs[num] = d[m.end():end if end > 0 else len(d)]


def stream_of(raw):
    m = re.search(rb'stream\r?\n', raw)
    if not m:
        return None
    e = raw.find(b'endstream', m.end())
    body = raw[m.end():e if e > 0 else len(raw)]
    if b'FlateDecode' in raw:
        try:
            return zlib.decompress(body)
        except Exception:
            try:
                return zlib.decompressobj().decompress(body)
            except Exception:
                return None
    return body


# ── ToUnicode CMaps, keyed by font object number ───────────────────────────
def parse_cmap(data):
    cmap = {}
    for blk in re.findall(rb'beginbfchar(.*?)endbfchar', data, re.S):
        for src, dst in re.findall(rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            cmap[int(src, 16)] = bytes.fromhex(dst.decode()).decode('utf-16-be', 'replace')
    for blk in re.findall(rb'beginbfrange(.*?)endbfrange', data, re.S):
        for lo, hi, dst in re.findall(
                rb'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>', blk):
            lo_i, hi_i = int(lo, 16), int(hi, 16)
            base = int(dst, 16)
            for k in range(hi_i - lo_i + 1):
                try:
                    cmap[lo_i + k] = chr(base + k)
                except ValueError:
                    pass
    return cmap


font_cmap = {}
for num, raw in objs.items():
    if b'/Type' in raw and b'/Font' in raw:
        m = re.search(rb'/ToUnicode\s+(\d+)\s+0\s+R', raw)
        if m:
            s = stream_of(objs.get(int(m.group(1)), b''))
            if s:
                font_cmap[num] = parse_cmap(s)

# ── pages: resource name -> font obj, plus content stream ──────────────────
pages = []
for num, raw in objs.items():
    if not re.search(rb'/Type\s*/Page\b', raw):
        continue
    fonts = {}
    fm = re.search(rb'/Font\s*<<(.*?)>>', raw, re.S)
    if fm:
        for name, ref in re.findall(rb'/(\w+)\s+(\d+)\s+0\s+R', fm.group(1)):
            fonts[name.decode()] = int(ref)
    cm = re.search(rb'/Contents\s+(\d+)\s+0\s+R', raw)
    if not cm:
        continue
    pages.append((num, fonts, int(cm.group(1))))

# Page objects carry no reliable order marker here; object number order matches
# document order in this file (verified by the page-1 title landing first).
pages.sort(key=lambda p: p[0])

out = []
for pnum, fonts, cref in pages:
    body = stream_of(objs.get(cref, b''))
    if not body:
        continue
    cur = {}
    text = []
    # A visual line is base_y (from Tm) + accumulated Td offset. Splitting on
    # Td alone breaks mid-word, because horizontal advances are also Td.
    base_y = 0.0
    td_y = 0.0
    last_line = None
    for tok in re.finditer(
            rb'/(\w+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj|\(((?:[^()\\]|\\.)*)\)\s*Tj'
            rb'|([\d.-]+)\s+([\d.-]+)\s+Td'
            rb'|([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+Tm', body):
        if tok.group(1):
            cur = font_cmap.get(fonts.get(tok.group(1).decode(), -1), {})
        elif tok.group(2):
            h = tok.group(2)
            codes = [int(h[i:i + 4], 16) for i in range(0, len(h), 4)]
            text.append(''.join(cur.get(c, '') for c in codes))
        elif tok.group(3) is not None:
            text.append(tok.group(3).decode('latin-1'))
        elif tok.group(4) is not None:
            td_y = float(tok.group(5))
            line = base_y + td_y
            if last_line is not None and abs(line - last_line) > 2:
                text.append('\n')
            last_line = line
        elif tok.group(11) is not None:
            base_y = float(tok.group(11))
            td_y = 0.0
    page = ''.join(text)
    page = re.sub(r'\n{3,}', '\n\n', page)
    out.append(f"\n=== p{len(out) + 1} ===\n{page}")

sys.stdout.write(''.join(out))
