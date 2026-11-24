/* 세꼼이 증여세 계산 엔진 v1 — tools/tax/gift-engine.cjs (2026-11-24)
   단위: 만원. 브라우저(<script>)와 Node(require) 양쪽에서 쓴다. 외부 의존 없음.
   기준일: 2026-11-24 현행. 법이 바뀌면 tools/tax/gift-law-test.cjs 에 기대값을 먼저 넣고 이 파일을 고친다(운영 기준 §16).

   근거와 확인 수준
   - 세율(상증법 §56·§26): 1억 10% / 5억 20%(누진공제 1천만) / 10억 30%(6천만) / 30억 40%(1억6천만) / 초과 50%(4억6천만)
   - 증여재산공제(§53, 10년 통산·수증자 기준·관계 그룹별): 배우자 6억 · 직계존속 5천만(미성년 2천만, 계부·계모 포함)
     · 직계비속 5천만 · 기타친족 1천만. 기타친족 = 4촌 이내 혈족·3촌 이내 인척(2025-03-14 개정, 법률 제20777호.
     그 전은 6촌·4촌 — 국세청 『상속·증여 세금상식Ⅱ』(2024)는 옛 범위다).
   - 혼인·출산 공제(§53의2): 직계존속으로부터, 혼인신고일 전후 2년 또는 출생·입양 후 2년, 둘 합쳐 평생 1억, §53과 별도.
   - 10년 합산(§47②): 해당 증여일 전 10년 안에 동일인(직계존속이면 그 배우자 포함)에게서 받은 종전 증여재산가액의
     합이 1천만 원 이상이면 가산. 대법원 판결 문언(「종전 증여재산가액을 합친 금액」) 기준으로 종전분만 센다.
   - 과세최저한(§55②): 과세표준 50만 원 미만이면 부과하지 않는다(국세청 『세금상식Ⅱ』 + 조문 해설 일치).
   - 세대생략 할증(§57): 30%, 미성년 + 증여재산가액 20억 초과 40%. 중간 세대가 사망해 대습하면 할증 없음.
   - 납부세액공제(§58): 가산한 종전 증여분의 「증여 당시 산출세액」을 공제. ⚠ 한도 계산은 간이(산출세액 이내로만 자름).
   - 신고세액공제(§69): 기한 내 신고 3%.
   - 증여 취득세(지방세법 §11①2·§13의2): 주택 3.5% + 지방교육세 0.3% (+ 85㎡ 초과 농특세 0.2%).
     조정대상지역 + 시가표준액 3억 이상 주택 → 12% + 교육세 0.4% (+ 85㎡ 초과 농특세 1.0%).
     단 1세대1주택자가 배우자·직계존비속에게 증여하면 중과 제외. 주택 외 부동산은 3.5% + 0.3% + 농특 0.2%.
     농특세 1.0%는 2차 자료 4곳 일치 + 산식 재구성 정합(농특세 = (취득세율 − 등록세 상당분 2%) × 10%:
     12%→1.0%, 8%→0.6% / 증여 3.5%는 등록세 상당분 1.5%라 0.2%). 원문 조문 글자 대조는 아니다.
   - 부담부증여: 채무 인수분은 증여자에게 양도(양도세), 수증자 증여세 과세가액은 (평가액 − 채무).
     취득세는 채무분 유상·나머지 무상. ⚠ 채무분 유상 취득세는 수증자 무주택→1주택 가정의 간이값(approx 표시).
     ⚠ 배우자·직계존비속 간 채무 인수는 객관적으로 입증돼야 인정된다(§47의 배우자·직계존비속 간 부담부증여 채무 추정) — 화면에서 고지한다.
   만들지 않는 것: 합산배제 증여재산(§55①1~3), 비거주자, 저가양도 증여의제, 비상장주식, 창업·가업 특례. */
(function(root){
  var RATE=[[10000,10,0],[50000,20,1000],[100000,30,6000],[300000,40,16000],[Infinity,50,46000]];
  /* rel: 'spouse' | 'ascendant'(직계존속에게서 받음: 부모·조부모·계부모) | 'descendant'(직계비속에게서 받음) | 'other_kin' | 'none' */
  function groupLimit(rel,minor){
    if(rel==='spouse')return 60000;
    if(rel==='ascendant')return minor?2000:5000;
    if(rel==='descendant')return 5000;
    if(rel==='other_kin')return 1000;
    return 0;
  }
  function giftRateTax(base){if(base<=0)return 0;for(var i=0;i<RATE.length;i++){var l=RATE[i][0],r=RATE[i][1],d=RATE[i][2];if(base<=l)return base*r/100-d;}return 0;}
  /* 입력
     rel, minor(수증자 만 19세 미만), skipGeneration(손자녀 등 세대 건너뜀, 중간 세대 생존), value(증여재산가액·시가), debt(인수 채무)
     priorSameDonor: {value: 10년 내 같은 증여자(부모면 두 분 합산) 종전 증여가액 합, calcTax: 그때 산출세액 합}
     deductUsedOther: 같은 공제 그룹에서 지난 10년간 「이번에 합산하지 않는」 다른 증여자에게 받으며 이미 쓴 증여재산공제
       (예: 할아버지에게 받을 때 쓴 공제. 합산하는 종전분(아버지·어머니)에서 쓴 공제는 넣지 않는다 — 합산 계산에서 다시 한 번만 공제된다)
     marriageBirth: {eligible, usedBefore}  fileOnTime(기본 true)
     re(부동산이면): {isHouse, adj(조정대상지역), stdPrice3eok(시가표준액 3억 이상), donorOneHouse(증여자 1세대1주택), over85}
  */
  function giftTax(i){
    var o={notes:[]};
    var value=+i.value||0, debt=Math.min(+i.debt||0,value);
    var net=value-debt;
    var priorV=(i.priorSameDonor&&+i.priorSameDonor.value)||0;
    o.priorAdded=priorV>=1000?priorV:0;
    if(priorV>0&&priorV<1000)o.notes.push('prior_under_1000');
    o.taxableValue=net+o.priorAdded;
    o.groupDeduct=Math.max(0,groupLimit(i.rel,!!i.minor)-(+i.deductUsedOther||0));
    o.mbDeduct=(i.rel==='ascendant'&&i.marriageBirth&&i.marriageBirth.eligible)?Math.max(0,10000-(+i.marriageBirth.usedBefore||0)):0;
    o.deduct=Math.min(o.taxableValue,o.groupDeduct+o.mbDeduct);
    o.base=Math.max(0,o.taxableValue-o.deduct);
    o.belowMin=o.base>0&&o.base<50;
    if(o.belowMin)o.base=0;
    o.calcTax=giftRateTax(o.base);
    o.surRate=(i.rel==='ascendant'&&i.skipGeneration)?((i.minor&&value>200000)?40:30):0;
    o.surcharge=o.calcTax*o.surRate/100;
    var priorCalc=o.priorAdded?((i.priorSameDonor&&+i.priorSameDonor.calcTax)||0):0;
    o.priorTaxCredit=Math.min(priorCalc,o.calcTax+o.surcharge);
    if(priorCalc)o.notes.push('prior_credit_simplified');
    var pre=Math.max(0,o.calcTax+o.surcharge-o.priorTaxCredit);
    o.fileCredit=(i.fileOnTime===false)?0:pre*0.03;
    o.giftTax=pre-o.fileCredit;
    o.acqTax=0;
    if(i.re){
      var r=i.re, isHouse=r.isHouse!==false;
      var exempt=r.donorOneHouse&&(i.rel==='spouse'||i.rel==='ascendant'||i.rel==='descendant');
      var heavy=isHouse&&!!r.adj&&!!r.stdPrice3eok&&!exempt;
      var gRate=heavy?12:3.5, gEdu=heavy?0.4:0.3;
      var gRural=isHouse?(r.over85?(heavy?1.0:0.2):0):0.2;
      o.acqHeavy=heavy;
      o.acqGiftRate=gRate+gEdu+gRural;
      o.acqGift=net*o.acqGiftRate/100;
      o.acqDebt=debt>0?debt*(isHouse?(1+0.1+(r.over85?0.2:0)):(4+0.4+0.2))/100:0;
      if(debt>0)o.notes.push('acq_debt_approx');
      o.acqTax=o.acqGift+o.acqDebt;
    }
    o.familyTotal=o.giftTax+o.acqTax; // 증여자 양도세(부담부)는 양도 엔진으로 따로 더한다
    return o;
  }
  /* 부담부증여 증여자 양도: 양도가액 = 채무, 취득가액 = 원취득가 × 채무/평가액 (양도가액·취득가액 안분) */
  function burdenTransfer(value,debt,donorAcqPrice){return {salePrice:debt,acqPrice:donorAcqPrice*debt/value};}
  /* 신고기한: 증여일이 속하는 달의 말일부터 3개월 → 3개월 뒤 달의 말일 */
  function fileDeadline(y,m){var mm=m+3,yy=y+Math.floor((mm-1)/12);mm=((mm-1)%12)+1;return {y:yy,m:mm,d:new Date(yy,mm,0).getDate()};}
  var api={giftTax:giftTax,giftRateTax:giftRateTax,groupLimit:groupLimit,burdenTransfer:burdenTransfer,fileDeadline:fileDeadline,RATE:RATE};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SekkomiGift=api;
})(typeof globalThis!=='undefined'?globalThis:this);
