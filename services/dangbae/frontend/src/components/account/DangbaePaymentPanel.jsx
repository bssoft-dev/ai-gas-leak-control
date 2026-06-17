import React, { useState } from 'react'

/**
 * 결제 수단 옵션
 * - bank_transfer: 계좌이체 (고정 계좌로 직접 이체)
 * - meet_and_pay: 만나서 결제 (배송원에게 현금/카드)
 */
const PAY_METHOD_OPTIONS = [
  {
    value: 'bank_transfer',
    label: '계좌이체',
    subtitle: '지정 계좌로 직접 이체',
    icon: '🏦',
    desc: '아래 계좌로 배송비를 이체하시면 배송이 진행됩니다.',
  },
  {
    value: 'meet_and_pay',
    label: '만나서 결제',
    subtitle: '배송원에게 직접 결제',
    icon: '🤝',
    desc: '배송원이 물건을 수령하거나 전달할 때 현금 또는 카드로 결제하세요.',
  },
]

const MEET_PAY_OPTIONS = [
  { value: 'cash', label: '현금', icon: '💵' },
  { value: 'card', label: '카드', icon: '💳' },
]

/** 환경변수에서 계좌 정보 읽기 (없으면 플레이스홀더) */
function getBankInfo() {
  return {
    bank: import.meta.env?.VITE_BANK_NAME || '광주은행',
    account: import.meta.env?.VITE_BANK_ACCOUNT || '123-456-789012',
    holder: import.meta.env?.VITE_BANK_HOLDER || '(주)모드엔',
  }
}

/**
 * 당배 결제 패널 — 계좌이체 · 만나서 결제
 */
export default function DangbaePaymentPanel({
  estimatedFare,
  paymentAmount,
  paymentOrderName,
  payMethod,
  meetPayType = 'cash',
  lastPrepare,
  onPaymentAmountChange,
  onPayMethodChange,
  onMeetPayTypeChange,
  onApplyEstimatedFare,
  onConfirmBankTransfer,
  onConfirmMeetPay,
  /** 'default' | 'after-order' */
  fareHintMode = 'default',
  /** 체크아웃 레이아웃 */
  layoutCheckout = false,
}) {
  const [copied, setCopied] = useState(false)
  const bank = getBankInfo()
  const amountNum = Math.max(0, Number(paymentAmount) || 0)

  const activeMethod = PAY_METHOD_OPTIONS.find((m) => m.value === payMethod) || PAY_METHOD_OPTIONS[0]

  function copyAccount() {
    const text = `${bank.bank} ${bank.account} (${bank.holder})`
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const fareHint =
    estimatedFare != null && estimatedFare > 0 ? (
      <>
        <span>예상 배송비: {Math.round(estimatedFare).toLocaleString()}원</span>
        {onApplyEstimatedFare && (
          <button type="button" className="dangbae-account-linkbtn" onClick={onApplyEstimatedFare}>
            결제 금액에 반영
          </button>
        )}
      </>
    ) : fareHintMode === 'after-order' ? (
      <span>견적 금액이 없으면 담당자에게 문의하세요.</span>
    ) : (
      <span>배송 신청에서 견적을 내면 금액에 반영할 수 있습니다.</span>
    )

  const panelClass =
    'dangbae-account-panel dangbae-account-payment dangbae-payment-panel dangbae-payment-panel--v2' +
    (layoutCheckout ? ' dangbae-payment-panel--checkout' : '')

  return (
    <section className={panelClass} aria-labelledby="dangbae-pay-title-v2">
      {/* 헤더 */}
      <div className="dpp2-header">
        <span className="dpp2-header__shield" aria-hidden="true">🛡️</span>
        <h4 id="dangbae-pay-title-v2" className="dpp2-header__title">
          {layoutCheckout ? '어떻게 결제하시겠어요?' : '배송비 결제'}
        </h4>
        <span className="dpp2-header__badge">안전 결제</span>
      </div>

      {/* 금액 카드 */}
      <div className="dpp2-amount-card">
        <div className="dpp2-amount-card__left">
          <span className="dpp2-amount-card__label">결제 금액</span>
          <div className="dpp2-amount-card__fare-hint">{fareHint}</div>
        </div>
        <div className="dpp2-amount-card__right">
          <strong className="dpp2-amount-card__value">{amountNum.toLocaleString()}</strong>
          <span className="dpp2-amount-card__won">원</span>
        </div>
      </div>

      {/* 주문명 표시 */}
      {paymentOrderName && (
        <p className="dpp2-order-name">📦 {paymentOrderName}</p>
      )}

      {/* 결제 수단 선택 */}
      <div className="dpp2-method-select" role="radiogroup" aria-label="결제 수단 선택">
        {PAY_METHOD_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={
              payMethod === opt.value
                ? 'dpp2-method-card dpp2-method-card--active'
                : 'dpp2-method-card'
            }
            id={`dpp2-method-${opt.value}`}
          >
            <input
              type="radio"
              name="dpp2_pay_method"
              value={opt.value}
              checked={payMethod === opt.value}
              onChange={() => onPayMethodChange(opt.value)}
              className="dpp2-method-radio"
            />
            <span className="dpp2-method-icon">{opt.icon}</span>
            <span className="dpp2-method-info">
              <span className="dpp2-method-label">{opt.label}</span>
              <span className="dpp2-method-subtitle">{opt.subtitle}</span>
            </span>
            {payMethod === opt.value && (
              <span className="dpp2-method-check" aria-hidden="true">✓</span>
            )}
          </label>
        ))}
      </div>

      {/* 계좌이체 상세 */}
      {payMethod === 'bank_transfer' && (
        <div className="dpp2-bank-panel" aria-label="계좌이체 정보">
          <p className="dpp2-bank-desc">{activeMethod.desc}</p>

          <div className="dpp2-bank-info">
            <div className="dpp2-bank-info__row">
              <span className="dpp2-bank-info__key">은행</span>
              <span className="dpp2-bank-info__val">{bank.bank}</span>
            </div>
            <div className="dpp2-bank-info__row">
              <span className="dpp2-bank-info__key">계좌번호</span>
              <span className="dpp2-bank-info__val dpp2-bank-info__val--account">
                {bank.account}
              </span>
            </div>
            <div className="dpp2-bank-info__row">
              <span className="dpp2-bank-info__key">예금주</span>
              <span className="dpp2-bank-info__val">{bank.holder}</span>
            </div>
            <div className="dpp2-bank-info__row dpp2-bank-info__row--amount">
              <span className="dpp2-bank-info__key">이체 금액</span>
              <span className="dpp2-bank-info__val dpp2-bank-info__val--amount">
                {amountNum.toLocaleString()}원
              </span>
            </div>
          </div>

          <button
            type="button"
            className="dpp2-btn-copy"
            onClick={copyAccount}
            id="dpp2-btn-copy-account"
          >
            {copied ? '✅ 복사됨' : '📋 계좌번호 복사'}
          </button>

          <div className="dpp2-bank-notice">
            <p>⚠️ 이체 후 아래 버튼을 눌러 완료 확인을 해주세요.</p>
          </div>

          <button
            type="button"
            className="dpp2-btn-confirm dpp2-btn-confirm--bank"
            onClick={onConfirmBankTransfer}
            disabled={amountNum === 0}
            id="dpp2-btn-confirm-bank"
          >
            이체 완료 확인
          </button>
        </div>
      )}

      {/* 만나서 결제 상세 */}
      {payMethod === 'meet_and_pay' && (
        <div className="dpp2-meet-panel" aria-label="만나서 결제 정보">
          <p className="dpp2-meet-desc">{activeMethod.desc}</p>

          <div className="dpp2-meet-amount">
            <span className="dpp2-meet-amount__label">결제 예정 금액</span>
            <span className="dpp2-meet-amount__value">{amountNum.toLocaleString()}원</span>
          </div>

          {/* 현금/카드 선택 */}
          <fieldset className="dpp2-meet-submethod" aria-label="결제 방법 선택">
            <legend className="dpp2-meet-submethod__legend">결제 방법</legend>
            <div className="dpp2-meet-submethod__options" role="radiogroup">
              {MEET_PAY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={
                    meetPayType === opt.value
                      ? 'dpp2-meet-opt dpp2-meet-opt--active'
                      : 'dpp2-meet-opt'
                  }
                  id={`dpp2-meet-opt-${opt.value}`}
                >
                  <input
                    type="radio"
                    name="dpp2_meet_pay_type"
                    value={opt.value}
                    checked={meetPayType === opt.value}
                    onChange={() => onMeetPayTypeChange?.(opt.value)}
                  />
                  <span className="dpp2-meet-opt__icon">{opt.icon}</span>
                  <span className="dpp2-meet-opt__label">{opt.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="dpp2-meet-notice">
            <ul>
              <li>배송원이 물건을 수령하거나 전달하는 시점에 결제합니다.</li>
              <li>금액은 배송원과 현장에서 확인 후 결제해주세요.</li>
              <li>영수증이 필요하신 경우 배송원에게 요청하세요.</li>
            </ul>
          </div>

          <button
            type="button"
            className="dpp2-btn-confirm dpp2-btn-confirm--meet"
            onClick={onConfirmMeetPay}
            disabled={amountNum === 0}
            id="dpp2-btn-confirm-meet"
          >
            만나서 결제로 신청 확정
          </button>
        </div>
      )}

      {/* 완료 상태 */}
      {lastPrepare?.merchant_uid && (
        <p className="dangbae-account-prepare-id">
          주문번호: <code>{lastPrepare.merchant_uid}</code>
        </p>
      )}
    </section>
  )
}
