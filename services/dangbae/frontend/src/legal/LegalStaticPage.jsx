import React from 'react'
import { getBusinessInfo } from './businessInfo'
import {
  TERMS_OF_SERVICE,
  PRIVACY_POLICY,
  REFUND_POLICY,
  SERVICE_PRICING_INTRO,
} from './legalTexts'
import './LegalStaticPage.css'

function injectTradeName(text, tradeName) {
  return text.replaceAll('__TRADE_NAME__', tradeName || '당배')
}

function LegalBody({ children }) {
  return (
    <div className="legal-body">
      {children.split('\n\n').map((block, i) => (
        <p key={i} className="legal-para">
          {block.split('\n').map((line, j) => (
            <React.Fragment key={j}>
              {j > 0 ? <br /> : null}
              {line}
            </React.Fragment>
          ))}
        </p>
      ))}
    </div>
  )
}

export default function LegalStaticPage({ route }) {
  const info = getBusinessInfo()
  const trade = info.tradeName

  const goHome = () => {
    window.location.hash = '#/landing'
    window.scrollTo(0, 0)
  }

  if (route === 'business') {
    return (
      <article className="legal-page" id="legal-top">
        <button type="button" className="legal-back" onClick={goHome}>
          ← 홈
        </button>
        <h1 className="legal-title">사업자 정보</h1>
        <p className="legal-lead">
          전자상거래 등에서의 소비자보호에 관한 법률에 따라 사업자 정보를 다음과 같이 공개합니다.
        </p>
        <table className="legal-table">
          <tbody>
            <tr>
              <th scope="row">상호</th>
              <td>{info.companyName}</td>
            </tr>
            <tr>
              <th scope="row">서비스명</th>
              <td>{info.tradeName}</td>
            </tr>
            <tr>
              <th scope="row">사업자등록번호</th>
              <td>{info.businessRegNo}</td>
            </tr>
            {/* <tr>
              <th scope="row">대표자명</th>
              <td>{info.representative}</td>
            </tr> */}
            {/* <tr>
              <th scope="row">사업장 주소</th>
              <td>{info.address}</td>
            </tr> */}
            <tr>
              <th scope="row">유선번호</th>
              <td>{info.phone}</td>
            </tr>
            {info.email ? (
              <tr>
                <th scope="row">전자우편</th>
                <td>{info.email}</td>
              </tr>
            ) : null}
            {info.mailOrderRegNo ? (
              <tr>
                <th scope="row">통신판매업 신고</th>
                <td>{info.mailOrderRegNo}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </article>
    )
  }

  if (route === 'service-pricing') {
    return (
      <article className="legal-page" id="legal-top">
        <button type="button" className="legal-back" onClick={goHome}>
          ← 홈
        </button>
        <h1 className="legal-title">서비스 · 요금 안내</h1>
        <LegalBody>{injectTradeName(SERVICE_PRICING_INTRO, trade)}</LegalBody>
      </article>
    )
  }

  const map = {
    terms: { title: '이용약관', text: TERMS_OF_SERVICE },
    privacy: { title: '개인정보처리방침', text: PRIVACY_POLICY },
    refund: { title: '환불정책', text: REFUND_POLICY },
  }
  const doc = map[route]
  if (!doc) return null

  return (
    <article className="legal-page" id="legal-top">
      <button type="button" className="legal-back" onClick={goHome}>
        ← 홈
      </button>
      <h1 className="legal-title">{doc.title}</h1>
      <LegalBody>{injectTradeName(doc.text, trade)}</LegalBody>
    </article>
  )
}
