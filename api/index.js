// 루트("/")와 정적 파일(/public/...)용 진입점.
//
// 이 프로젝트는 Vercel에서 정적 파일 서빙 없이 서버리스 함수만 빌드된다
// (실측: vercel inspect 결과 Builds에 λ api/[...path] 하나뿐이라 index.html이
// 404였다). 그래서 vercel.json의 rewrites로 /api 밖의 모든 경로를 이 함수로
// 보내고, Express가 로컬 3001번과 똑같이 index.html과 /public을 서빙한다.
// rewrites는 파일시스템 검사 뒤에 적용되므로 /api/* 는 [...path].js가 먼저 받는다.
import app from '../server/server.js';

export default app;
