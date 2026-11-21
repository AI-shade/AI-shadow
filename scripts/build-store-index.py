# 간판 이름 색인(server/data/store-index.bin) — 같은 이름이 «전국에 몇 곳인지» 서버가 바로 답한다(/api/geocode의 same).
# 카카오 검색 결과 수는 비슷한 이름까지 섞여서 «같은 이름 N곳»이 아니다 — 이 색인은 같은 이름만 센다.
#
# 넣는 목록(운영 중인 곳만):
#   소상공인시장진흥공단 상가(상권)정보 zip — 가게(학원 일부 포함). 어린이집·유치원·학교는 여기에 없다(11-21 확인:
#     «햇살어린이집» 0곳, 카카오 175건).
#   어린이집기본정보조회*.xls(시도별 여러 파일) — 운영현황 «정상»
#   전국초중등학교위치표준데이터*.xls — 운영상태 «운영»
#   학원교습소정보*.csv(cp949) — 등록상태명 «개원»
#
# 이름 키: 지점명(○○점·본점·N호점·괄호)을 떼고 띄어쓰기를 빼고 소문자(서버 storeKey와 같아야 한다).
# 지역: «시도 시군구»(주소 앞부분). 목록마다 시도 이름이 다르게 적히면(예: 통합 전후) 같은 곳도 두 지역으로 세어져
#   «여러 지역»으로 나온다 — 좁히는 쪽으로 틀리지 않고 덜 좁히는 쪽으로 틀린다.
# 한 줄(10바이트): md5(키) 앞 6바이트 | 수 2바이트(최대 65535) | 지역 번호 2바이트(한 지역에만 있으면 번호, 여럿이면 65535)
# 해시 순으로 정렬해 두고 서버가 이분 탐색한다.
# ponytail: 48비트 해시라 약 190만 개에서 한 쌍쯤 충돌할 수 있다 — 이름을 저장하는 대신 받아들인 값이다.
#
# 사용: python scripts/build-store-index.py <상가정보.zip> server/data [어린이집*.xls ...] [학교*.xls] [학원*.csv]
import zipfile, csv, io, re, sys, os, hashlib, struct, json
from collections import defaultdict

zpath, out_dir = sys.argv[1:3]
extras = sys.argv[3:]
os.makedirs(out_dir, exist_ok=True)

def key(name):
    # 지점명을 뗀다 — «교보문고 광화문점»을 «교보문고»와 같은 가게로 센다(AI허브 간판 150장으로 잰 11-21).
    parts = re.sub(r'\s+', ' ', name).strip().split(' ')
    if len(parts) > 1 and parts[-1].endswith('점'):
        parts = parts[:-1]
    s = re.sub(r'\(.*?\)', '', ''.join(parts))
    return re.sub(r'(본점|직영점|\d+호점)$', '', s).lower()

def area(addr):
    # «충청북도 청주시 흥덕구 …» → «충청북도 청주시 흥덕구», «서울특별시 송파구 …» → «서울특별시 송파구»
    t = str(addr or '').split()
    if len(t) < 2:
        return None
    if len(t) > 2 and t[1].endswith('시') and t[2].endswith('구'):
        return t[0] + ' ' + t[1] + ' ' + t[2]
    return t[0] + ' ' + t[1]

assert key('교보문고 광화문점') == '교보문고'
assert key('해님 어린이집 2호점') == '해님어린이집'
assert key('김밥천국(본점)') == '김밥천국'
assert key('청솔 피아노') == '청솔피아노'
assert area('충청북도 청주시 흥덕구 서원대로 1') == '충청북도 청주시 흥덕구'
assert area('서울특별시 송파구 거마로2길') == '서울특별시 송파구'

count = defaultdict(int)
region = {}            # 키 → 지역(하나뿐일 때) 또는 None(여럿)
src = defaultdict(int)

def add(name, where, tag):
    k = key(str(name or ''))
    if len(k) < 2:
        return
    count[k] += 1
    src[tag] += 1
    if k not in region:
        region[k] = where
    elif region[k] != where:
        region[k] = None

z = zipfile.ZipFile(zpath)
for m in z.namelist():
    if m.endswith('.csv'):
        for r in csv.DictReader(io.TextIOWrapper(z.open(m), encoding='utf-8-sig')):
            add(r['상호명'], r['시도명'] + ' ' + r['시군구명'], '상가')

def xls_rows(path):
    import xlrd
    s = xlrd.open_workbook(path).sheet_by_index(0)
    head = None
    for i in range(s.nrows):
        row = [str(s.cell_value(i, c)).strip() for c in range(s.ncols)]
        if head is None:
            if any(row):
                head = row
            continue
        yield dict(zip(head, row))

for p in extras:
    b = os.path.basename(p)
    if '어린이집' in b:
        for r in xls_rows(p):
            if r.get('운영현황') == '정상':
                add(r.get('어린이집명'), area(r.get('주소')), '어린이집')
    elif '학교' in b:
        for r in xls_rows(p):
            if r.get('운영상태') == '운영':
                add(r.get('학교명'), area(r.get('소재지도로명주소') or r.get('소재지지번주소')), '학교')
    elif '학원' in b:
        for r in csv.DictReader(open(p, encoding='cp949', errors='replace', newline='')):
            if r.get('등록상태명') == '개원':
                add(r.get('학원명'), area(r.get('도로명주소')), '학원')
    else:
        sys.exit('어떤 목록인지 모르는 파일: ' + b)

names = sorted({g for g in region.values() if g})
assert len(names) < 65535, len(names)
idx = {g: i for i, g in enumerate(names)}

rows = []
for k, n in count.items():
    h = hashlib.md5(k.encode('utf-8')).digest()[:6]
    g = region[k]
    rows.append(h + struct.pack('>HH', min(n, 65535), 65535 if g is None else idx[g]))
rows.sort()

with open(os.path.join(out_dir, 'store-index.bin'), 'wb') as f:
    for r in rows:
        f.write(r)
with open(os.path.join(out_dir, 'store-sigungu.json'), 'w', encoding='utf-8') as f:
    json.dump(names, f, ensure_ascii=False)
print('names', len(rows), 'areas', len(names), 'bytes', len(rows) * 10, dict(src))
