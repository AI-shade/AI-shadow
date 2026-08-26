# -*- coding: utf-8 -*-
u"""EXIF GPS 고정 사진을 만든다.

왜 만드는가: 저장소의 시험 사진에는 GPS가 박힌 것이 하나도 없다(전부 방향·기기
정보 120~182바이트뿐). 좌표를 읽는 코드를 만들면서 "읽었다"를 확인할 대상이
없으면 검증이 불가능하다.

만드는 것 (test/fixtures/exif/):
  gps-north-east.jpg  북위·동경 (한국) — 흔한 경우
  gps-south-west.jpg  남위·서경 — 부호 처리 확인 (N/S, E/W를 무시하면 여기서 틀린다)
  gps-motorola.jpg    바이트 순서가 MM(빅엔디언) — II만 처리하면 여기서 틀린다
  gps-zero-denom.jpg  분모가 0인 유리수 — 나눗셈에서 죽지 않는지
  no-gps.jpg          EXIF는 있는데 GPS IFD가 없음 — "없다"를 제대로 말하는지
  no-exif.jpg         EXIF 자체가 없음

사용법: python make-exif-fixtures.py
"""
import io
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'fixtures', 'exif')

# 아주 작은 유효한 JPEG(1x1, 흰색). 좌표를 읽는 코드를 시험하는 것이 목적이라
# 그림 내용은 상관없다. 파일이 작아 저장소에도 부담이 없다.
TINY_JPEG = bytes([
    0xFF, 0xD8,                                      # SOI
    0xFF, 0xDB, 0x00, 0x43, 0x00,                    # DQT
] + [0x08] * 64 + [
    0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,  # SOF0 1x1 grayscale
    0xFF, 0xC4, 0x00, 0x1F, 0x00,                    # DHT (DC)
] + [0x00] * 16 + list(range(12)) + [
    0xFF, 0xC4, 0x00, 0x1F, 0x10,                    # DHT (AC)
] + [0x00] * 16 + list(range(12)) + [
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00,  # SOS
    0x7F,                                            # 압축 데이터 1바이트
    0xFF, 0xD9,                                      # EOI
])


def rational(num, den):
    return struct.pack('<II', num, den) if ENDIAN == '<' else struct.pack('>II', num, den)


def dms(deg_float, zero_denominator=False):
    u"""십진 도 -> (도, 분, 초) 유리수 3개. 초는 100분의 1초까지 담는다."""
    deg = int(deg_float)
    rem = (deg_float - deg) * 60
    minute = int(rem)
    sec = round((rem - minute) * 60 * 100)
    if zero_denominator:
        # 분모가 0인 유리수를 일부러 넣는다 — 나눗셈에서 죽지 않아야 한다
        return rational(deg, 0) + rational(minute, 1) + rational(sec, 100)
    return rational(deg, 1) + rational(minute, 1) + rational(sec, 100)


def build_ifd(entries, next_ifd_offset, data_base):
    u"""entries: [(tag, type, count, payload_bytes_or_inline_int)]
    12바이트에 안 들어가는 값은 data_base 뒤에 붙이고 오프셋을 적는다."""
    n = len(entries)
    body = b''
    extra = b''
    # 값 영역 시작 = data_base + (2 + n*12 + 4)
    value_start = data_base + 2 + n * 12 + 4
    for tag, typ, count, payload in entries:
        if isinstance(payload, int):
            val = struct.pack(ENDIAN + 'I', payload)
        elif len(payload) <= 4:
            val = payload + b'\x00' * (4 - len(payload))
        else:
            val = struct.pack(ENDIAN + 'I', value_start + len(extra))
            extra += payload
            if len(payload) % 2:
                extra += b'\x00'
        body += struct.pack(ENDIAN + 'HHI', tag, typ, count) + val
    return struct.pack(ENDIAN + 'H', n) + body + struct.pack(ENDIAN + 'I', next_ifd_offset) + extra


def make_exif(lat=None, lng=None, lat_ref='N', lng_ref='E', taken=None,
              make=None, model=None, zero_denominator=False):
    u"""TIFF 블록(Exif\\0\\0 뒤에 오는 것)을 만든다."""
    gps_entries = []
    if lat is not None:
        gps_entries = [
            (0x0001, 2, 2, lat_ref.encode() + b'\x00'),                 # GPSLatitudeRef
            (0x0002, 5, 3, dms(lat, zero_denominator)),                 # GPSLatitude
            (0x0003, 2, 2, lng_ref.encode() + b'\x00'),                 # GPSLongitudeRef
            (0x0004, 5, 3, dms(lng)),                                   # GPSLongitude
            (0x0005, 1, 1, 0),                                          # GPSAltitudeRef (0=해수면 위)
            (0x0006, 5, 1, rational(3750, 100)),                        # GPSAltitude 37.5m
        ]

    exif_entries = []
    if taken:
        exif_entries.append((0x9003, 2, len(taken) + 1, taken.encode() + b'\x00'))

    # IFD0을 먼저 조립해야 GPS/Exif IFD가 놓일 위치를 안다.
    # 두 번 만든다 — 첫 번째는 크기만 재고, 두 번째에 실제 오프셋을 넣는다.
    def assemble(gps_off, exif_off):
        e = []
        if make:
            e.append((0x010F, 2, len(make) + 1, make.encode() + b'\x00'))
        if model:
            e.append((0x0110, 2, len(model) + 1, model.encode() + b'\x00'))
        e.append((0x0112, 3, 1, 1))  # Orientation
        if gps_entries:
            e.append((0x8825, 4, 1, gps_off))
        if exif_entries:
            e.append((0x8769, 4, 1, exif_off))
        return build_ifd(e, 0, 8)

    probe = assemble(0, 0)
    gps_off = 8 + len(probe)
    gps_block = build_ifd(gps_entries, 0, gps_off) if gps_entries else b''
    exif_off = gps_off + len(gps_block)
    exif_block = build_ifd(exif_entries, 0, exif_off) if exif_entries else b''
    ifd0 = assemble(gps_off, exif_off)
    assert len(ifd0) == len(probe), 'IFD0 크기가 달라졌다 — 오프셋이 어긋난다'

    header = (b'II' if ENDIAN == '<' else b'MM') + struct.pack(ENDIAN + 'H', 42) \
        + struct.pack(ENDIAN + 'I', 8)
    return header + ifd0 + gps_block + exif_block


def write_jpeg(path, tiff):
    u"""TINY_JPEG의 SOI 바로 뒤에 APP1(Exif)를 끼워 넣는다."""
    if tiff is None:
        data = TINY_JPEG
    else:
        payload = b'Exif\x00\x00' + tiff
        app1 = b'\xFF\xE1' + struct.pack('>H', len(payload) + 2) + payload
        data = TINY_JPEG[:2] + app1 + TINY_JPEG[2:]
    with open(path, 'wb') as f:
        f.write(data)
    print('  %-22s %5d bytes' % (os.path.basename(path), len(data)))


if not os.path.isdir(OUT):
    os.makedirs(OUT)

print('EXIF fixtures ->', OUT)

# 서울 시청 근처 — 북위·동경
ENDIAN = '<'
write_jpeg(os.path.join(OUT, 'gps-north-east.jpg'),
           make_exif(lat=37.566535, lng=126.977969, lat_ref='N', lng_ref='E',
                     taken='2026:08:27 14:32:10', make='Apple', model='iPhone 15 Pro'))

# 부에노스아이레스 — 남위·서경. 두 부호가 모두 음수인 경우를 시험한다
# (S만 넣고 W를 안 넣으면 서경 부호가 검증되지 않는다).
write_jpeg(os.path.join(OUT, 'gps-south-west.jpg'),
           make_exif(lat=34.603722, lng=58.381592, lat_ref='S', lng_ref='W',
                     taken='2026:01:02 09:00:00', make='Samsung', model='SM-S928N'))

# 분모가 0 — 나눗셈에서 죽지 않아야 한다
write_jpeg(os.path.join(OUT, 'gps-zero-denom.jpg'),
           make_exif(lat=37.5, lng=127.0, zero_denominator=True))

# 빅엔디언(MM) — II만 처리하면 여기서 틀린다
ENDIAN = '>'
write_jpeg(os.path.join(OUT, 'gps-motorola.jpg'),
           make_exif(lat=35.179554, lng=129.075642, lat_ref='N', lng_ref='E',
                     taken='2026:03:04 18:20:00'))

# EXIF는 있는데 GPS IFD가 없음 — 저장소의 실제 사진들과 같은 상태
ENDIAN = '<'
write_jpeg(os.path.join(OUT, 'no-gps.jpg'),
           make_exif(taken='2026:05:06 07:08:09', make='Apple', model='iPhone 13'))

# EXIF 자체가 없음
write_jpeg(os.path.join(OUT, 'no-exif.jpg'), None)

print('done')
