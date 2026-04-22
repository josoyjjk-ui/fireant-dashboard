// Google Apps Script — Block Street AMA 사전질문 폼 생성
// 사용법: https://script.google.com 에서 새 프로젝트 만들고 이 코드 붙여넣기 → 실행

function createBlockStreetAMAForm() {
  var form = FormApp.create('Block Street AMA 사전질문 🔥');
  
  form.setDescription(
    '📌 Block Street AMA with 불개미\n' +
    '🗓 일정 : 2월 25일 오후 9시\n\n' +
    '토큰화주식 렌딩 프로토콜 Block Street AMA 사전질문을 받습니다.\n' +
    '좋은 질문을 해주신 분들께 리워드가 지급됩니다!\n\n' +
    '🔥 AMA 리워드 : Block Street NFT 50개'
  );
  
  form.setConfirmationMessage('사전질문이 제출되었습니다! AMA에서 만나요 🔥');
  
  // 1. 텔레그램 닉네임
  form.addTextItem()
    .setTitle('텔레그램 닉네임 (@)')
    .setHelpText('예: @fireant')
    .setRequired(true);
  
  // 2. 참여 조건 체크
  var checkItem = form.addCheckboxItem();
  checkItem.setTitle('참여 조건 확인 (모두 체크)')
  checkItem.setChoices([
    checkItem.createChoice('불개미 Crypto 채널 입장 완료'),
    checkItem.createChoice('불개미 트위터 팔로우 완료'),
    checkItem.createChoice('불개미 유튜브 구독 완료'),
    checkItem.createChoice('Block Street 한국채널 입장 완료'),
    checkItem.createChoice('Block Street 대화방 입장 완료')
  ]);
  checkItem.setRequired(true);
  
  // 3. 사전질문
  form.addParagraphTextItem()
    .setTitle('Block Street에 대해 궁금한 점을 자유롭게 작성해 주세요')
    .setHelpText('토큰화주식, 렌딩 프로토콜, 로드맵, 파트너십 등 무엇이든 좋습니다')
    .setRequired(true);
  
  // 4. 지갑 주소 (NFT 수령용)
  form.addTextItem()
    .setTitle('NFT 수령용 지갑 주소')
    .setHelpText('리워드 당첨 시 NFT를 받을 지갑 주소를 입력해 주세요')
    .setRequired(false);
  
  Logger.log('✅ 폼 생성 완료!');
  Logger.log('📋 편집 링크: ' + form.getEditUrl());
  Logger.log('🔗 응답 링크: ' + form.getPublishedUrl());
}
