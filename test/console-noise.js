/*
 * 테스트 중 무시해도 되는 콘솔 잡음.
 *
 * 프런트는 들어오자마자 /api/access-check를 한 번 불러 "팀 접근 코드가 필요한
 * 곳인가"를 확인한다. 백엔드 없이 index.html만 띄우는 테스트에서는 이게 404가
 * 나고, 브라우저가 콘솔에 에러를 찍는다 — 우리 코드가 낸 에러가 아니고,
 * 실제 배포판에서는 이 주소가 늘 존재한다.
 *
 * 404를 통째로 무시하면 진짜 404를 놓치므로, 이 주소 하나만 짚어서 뺀다.
 */
const 무시할주소 = ['/api/access-check'];

function 무시해도되나(msg) {
  if (msg.type() !== 'error') return true;
  const url = (msg.location() && msg.location().url) || '';
  return 무시할주소.some((u) => url.includes(u));
}

module.exports = { 무시해도되나 };
