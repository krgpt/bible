#!/usr/bin/env python3
"""
성경 검색 웹앱 데이터 빌더
소스: KJV.csv / ENG-NIV-test/*.txt / KOR-개역개정-text/*.txt
출력: <app>/data/meta.js, kor.js, niv.js, kjv.js
"""
import os, re, sys, csv, json, io, collections

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = r"C:\ZZ-Nathan Work\AI\AI-Ring\Bible"
APP = os.path.join(ROOT, "bible-webapp")
OUT = os.path.join(APP, "data")
os.makedirs(OUT, exist_ok=True)

KJV_CSV = os.path.join(ROOT, "ENG-KJV-text", "KJV.csv")
NIV_DIR = os.path.join(ROOT, "ENG-NIV-test")
KOR_DIR = os.path.join(ROOT, "KOR-개역개정-text")

NB = 66
WS = re.compile(r"[ \t\u00a0]+")
# 입력 과정에서 섞여 들어간 전각 문장부호를 ASCII로 정규화한다
FULLWIDTH = str.maketrans({
    "\uff1a": ":", "\uff0c": ",", "\uff1b": ";", "\uff01": "!", "\uff1f": "?",
    "\uff08": "(", "\uff09": ")", "\uff0e": ".", "\u3002": ".",
})


def clean(s: str) -> str:
    s = s.replace("\u00a0", " ")
    s = s.replace("’", "\u2019")
    s = s.translate(FULLWIDTH)
    s = WS.sub(" ", s).strip()
    return s


ABSENT_NOTE = re.compile(r"\s*\((?:[^()]*없음)\)\s*$")


def strip_absent_note(s: str) -> str:
    """'(6하반-8상반 없음)' 처럼 본문 뒤에 붙은 사역 표기를 떼어낸다.
    본문 전체가 '(없음)'인 절은 그대로 둔다."""
    t = ABSENT_NOTE.sub("", s).strip()
    return t or "(없음)"


# ---------------------------------------------------------------- KJV
def load_kjv():
    data = collections.defaultdict(lambda: collections.defaultdict(dict))
    names = {}
    shorts = {}
    with open(KJV_CSV, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            bi = int(row["Book Number"]); ch = int(row["Chapter"]); vs = int(row["Verse"])
            data[bi][ch][vs] = clean(row["Text"])
            names[bi] = row["Book Title (Long)"].strip()
            shorts[bi] = row["Book Title (Short)"].strip()
    return data, names, shorts


# ---------------------------------------------------------------- NIV
NIV_RE = re.compile(r"^(\d+):(\d+)(\+?)\s*(.*)$")
HDR_RE = re.compile(r"^[1-3]?[A-Z]{2,5}\s*$")


def load_niv(order_names):
    """returns {book_idx: {ch: {vs: text}}}, {book_idx: {ch: {vs: end}}}, korean names"""
    result = {}
    ko_names = {}
    stats = []
    for fname in sorted(os.listdir(NIV_DIR)):
        m = re.match(r"^(\d{2})-(.+?)\s*\((.+?)\)\.txt$", fname)
        if not m:
            continue
        bi = int(m.group(1))
        ko_names[bi] = m.group(3).strip()
        lines = open(os.path.join(NIV_DIR, fname), encoding="utf-8-sig").read().split("\n")
        chapters = collections.defaultdict(dict)
        last = None  # (ch, vs)
        skipped = 0
        for ln in lines[1:]:
            ln = ln.rstrip("\r")
            if not ln.strip():
                continue
            mm = NIV_RE.match(ln)
            if mm:
                ch, vs = int(mm.group(1)), int(mm.group(2))
                plus = mm.group(3) == "+"
                text = clean(mm.group(4))
                if plus and vs in chapters[ch]:
                    chapters[ch][vs] = clean(chapters[ch][vs] + " " + text)
                elif plus:
                    # '+' without a base verse -> attach to previous verse
                    if last:
                        chapters[last[0]][last[1]] = clean(chapters[last[0]][last[1]] + " " + text)
                    else:
                        chapters[ch][vs] = text
                else:
                    if vs in chapters[ch]:
                        chapters[ch][vs] = clean(chapters[ch][vs] + " " + text)
                    else:
                        chapters[ch][vs] = text
                    last = (ch, vs)
            elif HDR_RE.match(ln):
                skipped += 1  # stray book header such as "1KI"
            else:
                # wrapped continuation line
                if last:
                    chapters[last[0]][last[1]] = clean(chapters[last[0]][last[1]] + " " + ln)
        result[bi] = {ch: dict(vs) for ch, vs in sorted(chapters.items())}
        stats.append((bi, fname, sum(len(v) for v in chapters.values()), skipped))
    return result, ko_names, stats


# ---------------------------------------------------------------- KOR
KOR_RE = re.compile(r"^([가-힣]+)(\d+):(\d+)(?:-(\d+))?\s*(.*)$")
KOR_NOVERSE_RE = re.compile(r"^([가-힣]+)(\d+):\s*(.*)$")
HEAD_RE = re.compile(r"<([^>]*)>")


def load_kor():
    result = {}
    headings = {}
    abbrs = {}
    stats = []
    for fname in sorted(os.listdir(KOR_DIR)):
        m = re.match(r"^\d+-\d{2}(.+?)\.txt$", fname)
        if not m:
            continue
        testament, num = fname.split("-")[0], int(fname.split("-")[1][:2])
        bi = num if testament == "1" else 39 + num
        lines = open(os.path.join(KOR_DIR, fname), encoding="cp949", errors="replace").read().split("\n")
        chapters = collections.defaultdict(dict)
        spans = collections.defaultdict(dict)
        hd = collections.defaultdict(dict)
        ab = None
        last = None
        merged = 0
        continued = 0
        for ln in lines:
            ln = ln.rstrip("\r")
            if not ln.strip():
                continue
            # section headings -> collect then remove
            found = HEAD_RE.findall(ln)
            title = None
            if found:
                title = found[0].strip()
                ln = HEAD_RE.sub(" ", ln)
            mm = KOR_RE.match(ln)
            if mm:
                ab = ab or mm.group(1)
                ch, vs = int(mm.group(2)), int(mm.group(3))
                end = int(mm.group(4)) if mm.group(4) else None
                text = clean(mm.group(5))
                if end and end > vs:
                    spans[ch][vs] = end
                    merged += 1
                if vs in chapters[ch]:
                    chapters[ch][vs] = clean(chapters[ch][vs] + " " + text)
                else:
                    chapters[ch][vs] = text
                last = (ch, vs)
                if title and vs not in hd[ch]:
                    hd[ch][vs] = title
                continue
            mm2 = KOR_NOVERSE_RE.match(ln)
            if mm2:
                ab = ab or mm2.group(1)
                ch = int(mm2.group(2))
                text = clean(mm2.group(3))
                if last and last[0] == ch:
                    chapters[ch][last[1]] = clean(chapters[ch][last[1]] + " " + text)
                elif last:
                    chapters[last[0]][last[1]] = clean(chapters[last[0]][last[1]] + " " + text)
                continued += 1
                if title:
                    tgt = last if last else (ch, 1)
                    hd[tgt[0]].setdefault(tgt[1], title)
                continue
            # pure text line -> continuation
            if last:
                chapters[last[0]][last[1]] = clean(chapters[last[0]][last[1]] + " " + ln)
                continued += 1
        result[bi] = {ch: dict(vs) for ch, vs in sorted(chapters.items())}
        for ch, vsd in result[bi].items():
            for k, v in vsd.items():
                vsd[k] = strip_absent_note(v)
        spans = {ch: s for ch, s in spans.items() if s}
        hd = {ch: h for ch, h in hd.items() if h}
        if spans:
            headings.setdefault("_spans", {})[bi] = spans
        if hd:
            headings.setdefault("_hd", {})[bi] = hd
        abbrs[bi] = ab
        stats.append((bi, fname, sum(len(v) for v in chapters.values()), merged, continued))
    return result, headings, abbrs, stats


def patch_niv_chronicles(niv):
    """NIV 원본 1역대 파일은 21장이 통째로 빠지고 21~28장이 실제 22~29장 내용이며
    29장이 중복 수록되어 있다. 검증된 내용에 한해 장 번호를 바로잡는다."""
    b = niv.get(13)
    if not b:
        return None
    needed = [21, 22, 23, 24, 25, 26, 27, 28, 29]
    if not all(ch in b for ch in needed):
        return None
    fixed = {ch: v for ch, v in b.items() if ch < 21}
    for ch in range(21, 29):
        fixed[ch + 1] = b[ch]
    # b[29]는 b[28]의 중복 -> 버린다
    b.clear()
    b.update(dict(sorted(fixed.items())))
    return "1역대 21~28 -> 22~29 (장 번호 오류 보정), 중복 29장 제거, 21장은 원본 누락"


PATCH_FILE = os.path.join(APP, "build", "patches.txt")

# 원본에 절 번호만 있고 본문이 없는 절을 표시하는 값들
# (NIV/개역개정이 본문 비평에 따라 의도적으로 비워 둔 절)
ABSENT_VALUES = {"none", "absent", "없음", "n/a", "na", "—", "-", ""}


def is_absent_value(txt) -> bool:
    """본문 자리에 '없음' 계열 표기가 왔는지 판별한다. (괄호·공백 무시)"""
    if txt is None:
        return True
    t = str(txt).strip().lower().strip("[](){}<>「」『』 ")
    t = re.sub(r"\s+", "", t)
    return t in ABSENT_VALUES


def collect_absent(src):
    """텍스트가 비었거나 '(없음)'인 절을 골라내어 src에서 제거하고 목록으로 돌려준다."""
    out = {}
    for bi, chs in src.items():
        for ch, vsd in list(chs.items()):
            for vs, txt in list(vsd.items()):
                if is_absent_value(txt):
                    del vsd[vs]
                    out.setdefault(bi, {}).setdefault(ch, set()).add(vs)
    return out


def _book_lookup(en_names, ko_names, kor_abbr):
    idx = {}
    for bi in range(1, NB + 1):
        idx[str(bi)] = bi
        idx[en_names[bi].lower()] = bi
        idx[ko_names[bi]] = bi
        if kor_abbr.get(bi):
            idx[kor_abbr[bi]] = bi
    return idx


def load_patches(lookup):
    """build/patches.txt 를 읽어 항목 목록을 돌려준다.

    형식:  역본 | 책 | 장:절 | 본문
      - 역본: KOR / NIV / KJV (대소문자 무관)
      - 책  : 번호(1~66), 영어명(Genesis), 한글명(창세기) 중 아무거나
      - 본문이 비었거나 TODO 로 시작하면 '대기'로만 집계하고 적용하지 않는다
      - '장:절-끝절' 형식은 해당 절 범위 병합(sp)을 해제한다
    """
    entries = []
    if not os.path.exists(PATCH_FILE):
        return entries
    with open(PATCH_FILE, encoding="utf-8-sig") as f:
        for ln, raw in enumerate(f, 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 4:
                entries.append({"line": ln, "err": "필드가 4개가 아닙니다"})
                continue
            tr = parts[0].lower()
            if tr not in ("kor", "niv", "kjv"):
                entries.append({"line": ln, "err": "역본 이름 오류: " + parts[0]})
                continue
            bi = lookup.get(parts[1].lower()) or lookup.get(parts[1])
            if not bi:
                entries.append({"line": ln, "err": "책 이름 오류: " + parts[1]})
                continue
            m = re.match(r"^(\d+):(\d+)(?:-(\d+))?$", parts[2])
            if not m:
                entries.append({"line": ln, "err": "참조 형식 오류: " + parts[2]})
                continue
            text = "|".join(parts[3:]).strip()
            entries.append({
                "line": ln, "tr": tr, "bi": bi,
                "ch": int(m.group(1)), "vs": int(m.group(2)),
                "to": int(m.group(3)) if m.group(3) else None,
                "text": text,
                "pending": (not text) or text.upper().startswith("TODO"),
            })
    return entries


def apply_patches(src, tid, entries, spans_by_book=None, absent_map=None):
    """patches.txt 항목을 해당 역본 데이터에 반영한다.

    본문 대신 NONE(또는 없음)을 적으면 '이 역본에 없는 절'로 등록한다.
    """
    res = {"applied": [], "pending": [], "errors": [], "spans_cleared": [], "absent": []}
    for e in entries:
        if "err" in e:
            res["errors"].append(e)
            continue
        if e["tr"] != tid:
            continue
        bi, ch, vs = e["bi"], e["ch"], e["vs"]
        if e["pending"]:
            res["pending"].append((bi, ch, vs))
            continue

        # '없음' 표기 -> 본문이 아니라 absent 목록에 넣는다
        if is_absent_value(e["text"]):
            src.get(bi, {}).get(ch, {}).pop(vs, None)
            if absent_map is not None:
                absent_map.setdefault(bi, {}).setdefault(ch, set()).add(vs)
            res["absent"].append((bi, ch, vs))
            continue

        vsd = src.setdefault(bi, {}).setdefault(ch, {})
        vsd[vs] = clean(e["text"])
        res["applied"].append((bi, ch, vs))

        # 범위 병합(sp)에 속한 절을 개별 입력하면 병합을 해제한다
        if spans_by_book:
            sp = spans_by_book.get(bi, {}).get(ch)
            if sp:
                for s in list(sp):
                    if s < vs <= sp[s]:
                        end = sp.pop(s)
                        res["spans_cleared"].append((bi, ch, s, end))
    return res


def main():
    kjv, en_names, kjv_short = load_kjv()
    niv, ko_names, niv_stats = load_niv(en_names)
    kor, kor_extra, kor_abbr, kor_stats = load_kor()
    niv_patch_note = patch_niv_chronicles(niv)
    kor_spans = kor_extra.get("_spans", {})
    kor_hd = kor_extra.get("_hd", {})

    # ---- 원본에 본문이 없는 절('없음') 분리 ----
    absent = {
        "kjv": collect_absent(kjv),
        "niv": collect_absent(niv),
        "kor": collect_absent(kor),
    }

    # ---- build/patches.txt 반영 ----
    lookup = _book_lookup(en_names, ko_names, kor_abbr)
    patch_entries = load_patches(lookup)
    patch_stats = {}
    for tid, src, sp in (("kjv", kjv, None), ("niv", niv, None), ("kor", kor, kor_spans)):
        patch_stats[tid] = apply_patches(src, tid, patch_entries, sp, absent[tid])

    # sanity: every translation must have 66 books
    for name, d in [("kjv", kjv), ("niv", niv), ("kor", kor)]:
        assert len(d) == NB, f"{name} has {len(d)} books"

    # canonical chapter list per book from KJV (complete), then maxV from all
    meta_books = []
    for bi in range(1, NB + 1):
        kjv_chs = sorted(kjv[bi].keys())
        assert kjv_chs == list(range(1, len(kjv_chs) + 1)), f"KJV book {bi} chapter gap"
        counts = {"kjv": [], "niv": [], "kor": []}
        maxv = {"kjv": [], "niv": [], "kor": []}
        for ch in kjv_chs:
            for tid, src in (("kjv", kjv), ("niv", niv), ("kor", kor)):
                d = src[bi].get(ch, {})
                gone = absent[tid].get(bi, {}).get(ch, set())
                # '없음' 절도 절 번호는 살아 있으므로 개수/최대절에 포함한다
                counts[tid].append(len(d) + len(gone))
                maxv[tid].append(max([max(d) if d else 0] + list(gone)))
        meta_books.append({
            "i": bi,
            "en": en_names[bi],
            "ko": ko_names[bi],
            "ab": {"kjv": kjv_short[bi], "kor": kor_abbr.get(bi, "")},
            "ch": len(kjv_chs),
            "v": maxv,
            "c": counts,
        })

    meta = {
        "translations": [
            {"id": "kor", "label": "개역개정", "short": "KOR", "lang": "ko"},
            {"id": "niv", "label": "NIV", "short": "NIV", "lang": "en"},
            {"id": "kjv", "label": "KJV", "short": "KJV", "lang": "en"},
        ],
        "books": meta_books,
        "generated": "2026-11-13",
    }

    # ---- write data files ----
    def pack(src, spans=None, hd=None, na=None):
        books = []
        for bi in range(1, NB + 1):
            chs = []
            for ch in sorted(src[bi].keys()):
                d = src[bi][ch]
                gone = (na or {}).get(bi, {}).get(ch, set())
                n = max([max(d) if d else 0] + list(gone))
                arr = [None] * n
                for vs, txt in d.items():
                    arr[vs - 1] = txt
                chs.append(arr)
            entry = {"i": bi, "ch": chs}
            if spans and bi in spans:
                entry["sp"] = {str(k): v for k, v in spans[bi].items() if v}
            if hd and bi in hd:
                entry["hd"] = {str(k): v for k, v in hd[bi].items()}
            if na and bi in na:
                entry["na"] = {str(ch): sorted(vs) for ch, vs in sorted(na[bi].items()) if vs}
            books.append(entry)
        return books

    for tid, src, spans, hd in [
        ("kjv", kjv, None, None),
        ("niv", niv, None, None),
        ("kor", kor, kor_spans, kor_hd),
    ]:
        payload = {"id": tid, "b": pack(src, spans, hd, absent[tid])}
        p = os.path.join(OUT, f"{tid}.js")
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            f.write(f"window.MD_BIBLE=window.MD_BIBLE||{{}};\nwindow.MD_BIBLE['{tid}']=")
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
            f.write(";\n")
        print(f"wrote {p}  {os.path.getsize(p)/1024/1024:.2f} MB")

    p = os.path.join(OUT, "meta.js")
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write("window.MD_BIBLE=window.MD_BIBLE||{};\nwindow.MD_BIBLE.meta=")
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"wrote {p}  {os.path.getsize(p)/1024:.1f} KB")

    # ---- validation report ----
    lines = []
    def rep(s=""):
        lines.append(s); print(s)

    rep("=" * 62)
    rep("검증 리포트")
    rep("=" * 62)
    for tid, src in [("KJV", kjv), ("NIV", niv), ("KOR", kor)]:
        tv = sum(len(v) for b in src.values() for v in b.values())
        rep(f"{tid}: {tv} verses")
    rep()
    # compare each chapter against KJV verse presence
    for tid, src in [("NIV", niv), ("KOR", kor)]:
        missing = []
        covered = []
        extra = []
        n = absent[tid.lower()]
        spans = kor_spans if tid == "KOR" else {}
        for bi in range(1, NB + 1):
            for ch in kjv[bi]:
                kset = set(kjv[bi][ch])
                tset = set(src[bi].get(ch, {}))
                gone = n.get(bi, {}).get(ch, set())
                sp = spans.get(bi, {}).get(ch, {})
                for vs in sorted(kset - tset - gone):
                    if any(s < vs <= e for s, e in sp.items()):
                        covered.append(f"{en_names[bi]} {ch}:{vs}  ({ko_names[bi]} {ch}:{vs})")
                    else:
                        missing.append(f"{en_names[bi]} {ch}:{vs}  ({ko_names[bi]} {ch}:{vs})")
                for vs in sorted(tset - kset):
                    extra.append(f"{en_names[bi]} {ch}:{vs}  ({ko_names[bi]} {ch}:{vs})")
        rep(f"[{tid}] KJV 기준 누락 절: {len(missing)}")
        for x in missing: rep("   - " + x)
        if covered:
            rep(f"[{tid}] 앞 절에 병합되어 번호만 없는 절: {len(covered)}")
            for x in covered: rep("   ~ " + x)
        rep(f"[{tid}] KJV에 없는 추가 절: {len(extra)}")
        for x in extra: rep("   + " + x)
        rep()

    # ---- 원본에 본문이 없는 절 ('없음') ----
    for tid in ("NIV", "KOR", "KJV"):
        n = absent[tid.lower()]
        items = [(bi, ch, vs) for bi in sorted(n) for ch in sorted(n[bi]) for vs in sorted(n[bi][ch])]
        rep(f"[{tid}] 원본에 본문이 없는 절(정상, '없음' 표기): {len(items)}")
        for bi, ch, vs in items:
            rep(f"   · {en_names[bi]} {ch}:{vs}  ({ko_names[bi]} {ch}:{vs})")
    rep()

    rep("[KOR] 병합(range) 처리: %d개, verse번호 누락 이어붙임: %d개" % (
        sum(s for _, _, _, s, _ in kor_stats), sum(c for _, _, _, _, c in kor_stats)))
    rep("[NIV] 제거된 잡음 헤더: %d개" % sum(s for _, _, _, s in niv_stats))
    if niv_patch_note:
        rep("[NIV] 패치 적용: " + niv_patch_note)
    rep()

    # ---- patches.txt 반영 결과 ----
    if os.path.exists(PATCH_FILE):
        rep("build/patches.txt 반영 결과")
        for tid in ("NIV", "KOR", "KJV"):
            st = patch_stats[tid.lower()]
            rep(f"  [{tid}] 적용 {len(st['applied'])}건 · 없음(NONE) {len(st['absent'])}건 · "
                f"대기 {len(st['pending'])}건 · 오류 {len(st['errors'])}건")
            for bi, ch, vs in st["absent"]:
                rep(f"     없음: {en_names[bi]} {ch}:{vs}")
            for bi, ch, vs in st["pending"]:
                rep(f"     대기: {en_names[bi]} {ch}:{vs}")
            for bi, ch, s, e in st["spans_cleared"]:
                rep(f"     병합 해제: {ko_names[bi]} {ch}:{s}-{e}")
        bad = [e for tid in ("niv", "kor", "kjv") for e in patch_stats[tid]["errors"]]
        for e in bad:
            rep(f"  ! {PATCH_FILE}:{e['line']}  {e['err']}")
        rep()
    else:
        rep("build/patches.txt 없음 (패치 미적용)")
        rep()

    rep("알려진 원본 결함")
    rep("  - NIV: 1역대 29:30을 제외한 65권에서 각 권의 마지막 절이 파일에서 잘려 있음")
    rep("  - NIV: 1역대 21장 전체 누락 (원본), 에스겔 23:48-49 누락 -> patches.txt로 보충")
    rep("  - NIV: 본문비평상 실제로 없는 15절은 절 번호만 있어 자동으로 '없음'(na) 처리")
    rep("  - KOR: 절 범위 병합 11곳 중 9곳은 patches.txt에서 인쇄본과 동일하게 분할 완료")
    rep("  - KOR: 남은 병합 2곳(행 15:25-26, 롬 9:1-2)은 인쇄본도 병합 상태 그대로")
    rep("  - KOR: 완역본이 '(없음)'으로 표기한 13절 + 행 24:7 -> '없음'(na) 처리")
    rep("  - KOR: 고후 13:14 / 요삼 1:15는 KJV와 절 번호 체계가 다를 뿐 본문은 존재")

    with open(os.path.join(APP, "build-report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


if __name__ == "__main__":
    main()
