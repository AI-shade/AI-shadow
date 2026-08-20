// fal.ai FLUX Fill 비용 계산 — 메가픽셀당 $0.05 (2026-08 기준 공식 요금)
//
// 별도 파일로 뺀 이유: 비용 계산이 틀리면 사용자 요금이 조용히 새기 때문에
// fal을 호출하지 않고 단위 테스트할 수 있어야 함 (test/inpaint.js).
//
// 참고: kontext 배경교체($0.04 정액)와 달리 Fill은 이미지 크기에 비례한다.
// 12MP 휴대폰 원본을 그대로 보내면 $0.61이 되므로, 프론트에서 보내기 전에
// 크기를 줄이는 것이 중요하다.

const USD_PER_MEGAPIXEL = 0.05;

export function estimateFillCostUsd(width, height) {
  if (!width || !height) return null;
  const megapixels = (width * height) / 1_000_000;
  return Math.round(megapixels * USD_PER_MEGAPIXEL * 1000) / 1000;
}
