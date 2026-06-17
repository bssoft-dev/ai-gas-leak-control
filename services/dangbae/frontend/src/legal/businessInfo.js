/**
 * 사업자 정보 — 사업자등록증(PDF 등)과 동일한 값을 .env의 VITE_LEGAL_* 에 설정하세요.
 * 빌드 시 주입되며, 미설정 시 아래 기본값(수정 필요)이 표시됩니다.
 */
export function getBusinessInfo() {
  return {
    /** 상호(앱에 표시되는 서비스 브랜드명) */
    tradeName: import.meta.env.VITE_LEGAL_TRADE_NAME || '당배',
    /** 법인/개인 사업자 상호(등록증 기준) */
    companyName:
      import.meta.env.VITE_LEGAL_COMPANY_NAME || '모든(Modn) Inc.',
    businessRegNo:
      import.meta.env.VITE_LEGAL_BUSINESS_REG_NO || '158-59-00909',
    representative:
      import.meta.env.VITE_LEGAL_REPRESENTATIVE || '반성훈',
    phone: import.meta.env.VITE_LEGAL_PHONE || '062-971-1114',
    address:
      import.meta.env.VITE_LEGAL_ADDRESS || '광주광역시 서구 월드컵4강로28번길 46, 301동 1707호',
    email: import.meta.env.VITE_LEGAL_EMAIL || 'admin@dangbae.kr',
    /** 통신판매업 신고번호(해당 시) */
    mailOrderRegNo: import.meta.env.VITE_LEGAL_MAIL_ORDER_NO || '',
  }
}
