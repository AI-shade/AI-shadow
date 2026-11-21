# 소상공인시장진흥공단 상가(상권)정보 zip → 간판 이름 색인(server/data/store-index.bin)
#
# 쓰임: 사진 속 간판 이름이 «전국에 몇 곳인지» 서버가 바로 답한다(/api/geocode의 same).
# 카카오 검색 결과 수는 비슷한 이름까지 섞여서 «같은 이름 N곳»이 아니다 — 이 색인은 같은 이름만 센다.
#
# 이름 키: 지점명(○○점·본점·N호점·괄호)을 떼고 띄어쓰기를 빼고 소문자(서버 storeKey와 같아야 한다).
# 한 줄(10바이트): md5(키) 앞 6바이트 | 가게 수 2바이트(최대 65535) | 시군구 번호 2바이트(한 시군구에만 있으면 번호, 여럿이면 65535)
# 해시 순으로 정렬해 두고 서버가 이분 탐색한다. 184만 개 → 약 18MB.
# ponytail: 48비트 해시라 184만 개에서 충돌 확률이 약 0.6%(한 쌍) — 이름을 저장하는 대신 받아들인 값이다.
#
# 사용: python scripts/build-store-index.py <상가정보.zip> server/data
import zipfile, csv, io, re, sys, os, hashlib, struct, json
from collections import defaultdict

zpath, out_dir = sys.argv[1:3]
os.makedirs(out_dir, exist_ok=True)

def key(name):
    # 지점명을 뗀다 — «교보문고 광화문점»을 «교보문고»와 같은 가게로 센다. 안 떼면 «교보문고»가 전국 1곳으로
    # 나왔다(AI허브 간판 150장으로 잰 11-21). 서버 storeKey와 같은 규칙이어야 한다.
    parts = re.sub(r'\s+', ' ', name).strip().split(' ')
    if len(parts) > 1 and parts[-1].endswith('점'):
        parts = parts[:-1]
    s = re.sub(r'\(.*?\)', '', ''.join(parts))
    return re.sub(r'(본점|직영점|\d+호점)$', '', s).lower()

assert key('교보문고 광화문점') == '교보문고'
assert key('해님 어린이집 2호점') == '해님어린이집'
assert key('김밥천국(본점)') == '김밥천국'
assert key('청솔 피아노') == '청솔피아노'

count = defaultdict(int)
region = {}            # 키 → 시군구코드(하나뿐일 때) 또는 None(여럿)
sgg = {}
z = zipfile.ZipFile(zpath)
for m in z.namelist():
    if not m.endswith('.csv'):
        continue
    for r in csv.DictReader(io.TextIOWrapper(z.open(m), encoding='utf-8-sig')):
        k = key(r['상호명'])
        if len(k) < 2:
            continue
        count[k] += 1
        c = r['시군구코드']
        sgg[c] = r['시도명'] + ' ' + r['시군구명']
        if k not in region:
            region[k] = c
        elif region[k] != c:
            region[k] = None

codes = sorted(sgg)
assert len(codes) < 65535, len(codes)
idx = {c: i for i, c in enumerate(codes)}

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
    json.dump([sgg[c] for c in codes], f, ensure_ascii=False)
print('names', len(rows), 'sigungu', len(codes), 'bytes', len(rows) * 10)
