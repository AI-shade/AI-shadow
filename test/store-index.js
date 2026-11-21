/*
 * 상가정보 색인(server/data/store-index.bin)이 «같은 이름 몇 곳»을 맞게 답하는지 잰다.
 * 기댓값은 build 때 원본 zip에서 직접 센 값이다(2026-09-30 상가정보). 데이터를 새로 받으면 숫자를 다시 적는다.
 *
 * 사용법: 이 폴더에서 → node store-index.js   (서버·브라우저·네트워크 없음, 비용 0)
 */
process.env.VERCEL = '1'; // server.js가 포트를 열지 않게(서버리스처럼 불러온다)
(async () => {
  const { storeLookup, storeKey } = await import('../server/server.js');
  let pass = 0, fail = 0;
  const ok = (c, name, d) => { if (c) { pass++; console.log('  ✓ ' + name + (d ? '  ' + d : '')); } else { fail++; console.log('  ✗ ' + name + (d ? '  → ' + d : '')); } };

  ok(storeKey(' 스타 벅스 ') === '스타벅스', '이름 키는 띄어쓰기를 빼고 소문자');
  ok(storeKey('ABC 학원') === 'abc학원', '영문은 소문자로');
  ok(storeKey('교보문고 광화문점') === '교보문고' && storeKey('해님 어린이집 2호점') === '해님어린이집', '지점명은 뗀다(색인 만들 때와 같은 규칙)');

  const sb = storeLookup('스타벅스');
  ok(sb && sb.count === 2251 && sb.sigungu === null, '프랜차이즈는 수천 곳, 시군구 여럿', JSON.stringify(sb));
  const sb2 = storeLookup('스타 벅스');
  ok(sb2 && sb2.count === sb.count, '띄어쓰기가 달라도 같은 이름');
  const none = storeLookup('없는가게이름쀍쀍');
  ok(none && none.count === 0, '없는 이름은 0곳', JSON.stringify(none));
  ok(storeLookup('가') === null, '한 글자는 묻지 않는다');

  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})();
