/* 세꼼이 — 계산 단계별 계측 (2026-08-11)
 *
 * 배경: GA4에 심긴 이벤트가 start_calc / calc_complete 두 개뿐이라
 *       "계산 시작 12명 중 9명이 어디서 이탈하는지" 알 수 없었다 (8/4 성장 병목 진단 3).
 *
 * 방식: index.html 본체를 건드리지 않고, defer 스크립트로 로드된 뒤
 *       전역 prog() / track() 을 감싼다. 본체 인라인 스크립트가 모두 실행된 다음
 *       실행되므로 두 함수는 이미 정의돼 있다.
 *
 * ⚠ 유지보수 주의: 단계 이름은 flow() 안의 prog() 호출 '순서'에 의존한다.
 *   flow()에 prog() 호출을 새로 끼워 넣으면 그 뒤 번호가 한 칸씩 밀린다.
 *   호출을 추가·삭제하면 아래 STEP_IDS도 함께 고쳐야 한다.
 *   (매핑에 없는 번호는 'qN'으로 떨어지므로 계측이 깨지지는 않는다.)
 */
(function () {
  'use strict';
  if (typeof prog !== 'function' || typeof track !== 'function') return;

  var STEP_IDS = {
    1: '01_address',           // 주소
    2: '02_resident',          // 거주자 여부
    3: '03_ptype',             // 주택 유형
    4: '04_acq_date',          // 취득일
    5: '05_acq_method',        // 취득 방법(매수/증여/상속)
    6: '06_acq_price',         // 취득가
    7: '07_cost_mode',         // 부대비용 입력 방식
    8: '08_acq_cost',          // 취득 부대비용
    9: '09_sale_price',        // 매도 희망가
    10: '10_sale_cost',        // 매도 부대비용
    11: '11_sale_date',        // 양도 예상 시기
    12: '12_ownership',        // 명의(단독/공동)
    13: '13_residence',        // 거주 여부
    14: '14_residence_detail', // 거주·임대 상세
    15: '15_other_houses',     // 다른 주택 수
    16: '16_other_house_acq'   // 다른 주택 취득일 (다주택자만 도달)
  };

  var _prog = prog, _track = track;
  var lastNo = 0, lastId = '', done = false, bailed = false;

  /* 단계 통과 이벤트
   * 본체의 pCount는 재시작(startBtn 재클릭) 시 리셋되지 않으므로 쓰지 않고
   * 자체 카운터를 둔다. start_calc에서 0으로 되돌린다. */
  prog = function () {
    var r = _prog.apply(this, arguments);
    try {
      lastNo += 1;
      lastId = STEP_IDS[lastNo] || ('q' + lastNo);
      _track('calc_step', { step_no: lastNo, step_id: lastId });
    } catch (e) {}
    return r;
  };

  /* 시작/완료를 관찰해 이탈 판정에 쓴다 */
  track = function (ev, params) {
    try {
      if (ev === 'start_calc') { lastNo = 0; lastId = ''; done = false; bailed = false; }
      else if (ev === 'calc_complete') { done = true; }
    } catch (e) {}
    return _track(ev, params);
  };

  /* 이탈 비콘 — 페이지를 벗어날 때 마지막으로 통과한 단계를 1회만 남긴다.
   * 주의: 모바일에서 앱 전환만 해도 visibilitychange가 뜬다.
   *       돌아와서 계산을 마치면 calc_abandon과 calc_complete가 같은 세션에 함께 남으므로,
   *       분석 시 calc_complete가 있는 세션은 제외하고 볼 것. */
  function bail() {
    if (bailed || done || !lastNo) return;
    bailed = true;
    try { _track('calc_abandon', { last_step_no: lastNo, last_step_id: lastId }); } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') bail();
  });
  window.addEventListener('pagehide', bail);
})();
