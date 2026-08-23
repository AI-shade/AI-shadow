// 버셀 서버리스 진입점.
//
// /api/ 아래로 오는 모든 요청이 이 파일 하나로 들어오고, 안에서 Express가 원래대로
// 라우팅한다. 파일 이름의 [...path]가 "/api 아래 무엇이든"이라는 뜻이라,
// 라우트를 하나 추가할 때마다 여기를 손댈 필요가 없다.
import app from '../server/server.js';

export default app;
