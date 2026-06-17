import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import DangbaePaymentPanel from './DangbaePaymentPanel'
import { readPendingPayment } from './paymentContext'
import './DangbaeAccountTab.css'

const PAY_HOLD_MS = 30 * 60 * 1000

function pickText(...vals) {
  for (const v of vals) {
    const s = String(v || '').trim()
    if (s) return s
  }
  return ''
}

function parseOrderName(orderName) {
  const s = String(orderName || '').trim()
  const m = s.match(/^(.+?)\((.*?),\s*(.*?)\)$/)
  if (!m) return { itemTitle: s || '배송 물품', originLabel: '', destLabel: '' }
  return {
    itemTitle: pickText(m[1], '배송 물품'),
    originLabel: pickText(m[2]),
    destLabel: pickText(m[3]),
  }
}

/**
 * 배송 요청 후 전용 결제 화면 (#/payment).
 * 포트원 PG 제거 → 계좌이체 · 만나서 결제
 */
export default function DangbaePaymentPage({
  getEventName,
  onAction,
  estimatedFare,
  userEmail,
  accountMsg,
  lastPrepare,
  onAppendLog,
  onGoToStatus,
  onBackToRequest,
}) {
  const [ctx, setCtx] = useState(() => readPendingPayment())
  const [paymentAmount, setPaymentAmount] = useState(() => {
    const c = readPendingPayment()
    if (c?.amount != null && Number(c.amount) > 0) return Math.round(Number(c.amount))
    return 0
  })
  const [paymentOrderName, setPaymentOrderName] = useState(() => {
    const c = readPendingPayment()
    return c?.order_name || '당배 배송비'
  })
  const [payMethod, setPayMethod] = useState('bank_transfer')
  const [meetPayType, setMeetPayType] = useState('cash')
  const [thankModal, setThankModal] = useState(false)
  const [confirmedOrderId, setConfirmedOrderId] = useState(null)

  const holdEndsAt = useMemo(() => Date.now() + PAY_HOLD_MS, [])
  const [holdRemainSec, setHoldRemainSec] = useState(() =>
    Math.max(0, Math.ceil((holdEndsAt - Date.now()) / 1000))
  )

  useEffect(() => {
    const t = setInterval(() => {
      setHoldRemainSec(Math.max(0, Math.ceil((holdEndsAt - Date.now()) / 1000)))
    }, 1000)
    return () => clearInterval(t)
  }, [holdEndsAt])

  useEffect(() => {
    const next = readPendingPayment()
    setCtx(next)
    if (next?.amount != null && Number(next.amount) > 0) {
      setPaymentAmount(Math.round(Number(next.amount)))
    }
    if (next?.order_name) setPaymentOrderName(next.order_name)
  }, [])

  const applyEstimatedFare = useCallback(() => {
    if (estimatedFare != null && estimatedFare > 0) {
      setPaymentAmount(Math.round(Number(estimatedFare)))
    }
  }, [estimatedFare])

  /** 계좌이체 완료 확인 */
  const handleConfirmBankTransfer = useCallback(() => {
    if (!onAction) return
    const c = readPendingPayment()
    const orderId =
      (c?.order_id && String(c.order_id).trim()) ||
      (lastPrepare?.order_id && String(lastPrepare.order_id).trim()) ||
      ''
    if (!orderId) {
      onAppendLog?.('주문 번호를 찾을 수 없습니다. 배송 신청 후 다시 시도해 주세요.')
      return
    }
    onAppendLog?.(`계좌이체 완료 확인 요청: order_id=${orderId}, amount=${paymentAmount}`)
    onAction(getEventName('onPaymentConfirm'), {
      order_id: orderId,
      merchant_uid: lastPrepare?.merchant_uid || `bank-${orderId}`,
      payment_method: 'bank_transfer',
      amount: Number(paymentAmount) || 0,
    })
    setConfirmedOrderId(orderId)
    setThankModal(true)
  }, [onAction, getEventName, lastPrepare, paymentAmount, onAppendLog])

  /** 만나서 결제 신청 확정 */
  const handleConfirmMeetPay = useCallback(() => {
    if (!onAction) return
    const c = readPendingPayment()
    const orderId =
      (c?.order_id && String(c.order_id).trim()) ||
      (lastPrepare?.order_id && String(lastPrepare.order_id).trim()) ||
      ''
    if (!orderId) {
      onAppendLog?.('주문 번호를 찾을 수 없습니다. 배송 신청 후 다시 시도해 주세요.')
      return
    }
    onAppendLog?.(`만나서 결제 신청: order_id=${orderId}, type=${meetPayType}`)
    onAction(getEventName('onPaymentConfirm'), {
      order_id: orderId,
      merchant_uid: lastPrepare?.merchant_uid || `meet-${orderId}`,
      payment_method: `meet_and_pay_${meetPayType}`,
      amount: Number(paymentAmount) || 0,
    })
    setConfirmedOrderId(orderId)
    setThankModal(true)
  }, [onAction, getEventName, lastPrepare, paymentAmount, meetPayType, onAppendLog])

  const emailForBuyer = userEmail?.trim() || ctx?.user_email || ''
  const holdMm = String(Math.floor(holdRemainSec / 60)).padStart(2, '0')
  const holdSs = String(holdRemainSec % 60).padStart(2, '0')
  const displayAmount = Math.max(0, Number(paymentAmount) || 0)
  const parsedFromOrderName = parseOrderName(paymentOrderName)
  const itemTitle = pickText(ctx?.item_title, ctx?.item_name, parsedFromOrderName.itemTitle, '배송 물품')
  const originLabel = pickText(
    ctx?.origin_address,
    ctx?.origin_detail,
    ctx?.pickup_address,
    parsedFromOrderName.originLabel,
    '출발지 정보 없음'
  )
  const destLabel = pickText(
    ctx?.dest_address,
    ctx?.dest_detail,
    ctx?.dropoff_address,
    parsedFromOrderName.destLabel,
    '도착지 정보 없음'
  )

  return (
    <div className="dangbae-account dangbae-payment-page checkout-payment-root">
      {/* 신청 완료 감사 모달 */}
      {thankModal && (
        <div
          className="dangbae-thank-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="thank-modal-title"
        >
          <div className="dangbae-thank-modal">
            <div className="dangbae-thank-modal__icon" aria-hidden="true">🎉</div>
            <h2 id="thank-modal-title" className="dangbae-thank-modal__title">
              신청해주셔서 감사합니다!
            </h2>
            <p className="dangbae-thank-modal__desc">
              배송 신청이 완료되었습니다.<br />
              '내 배송 현황'에서 진행 상태를 실시간으로 확인하세요.
            </p>
            {confirmedOrderId && (
              <p className="dangbae-thank-modal__order">
                주문번호: <strong>#{confirmedOrderId}</strong>
              </p>
            )}
            <button
              type="button"
              className="dangbae-thank-modal__btn"
              id="btn-goto-status-from-thank"
              onClick={() => {
                setThankModal(false)
                onGoToStatus?.()
              }}
            >
              내 배송 현황 보기 →
            </button>
          </div>
        </div>
      )}

      <div className="checkout-payment-toolbar">
        <div className="dangbae-payment-page-actions checkout-payment-toolbar__nav">
          <button type="button" className="dangbae-payment-nav-btn" onClick={onBackToRequest}>
            ← 배송 신청으로
          </button>
          <button
            type="button"
            className="dangbae-payment-nav-btn dangbae-payment-nav-btn--primary"
            onClick={onGoToStatus}
          >
            배송 현황 보기
          </button>
        </div>
      </div>

      <div className="checkout-hold-banner" role="status">
        <span className="checkout-hold-banner__icon" aria-hidden="true">⏱</span>
        <span className="checkout-hold-banner__text">
          결제를 진행해 주세요. 남은 시간 안에 완료해 주세요.
        </span>
        <span className="checkout-hold-banner__timer" aria-live="polite">
          {holdMm}:{holdSs}
        </span>
      </div>

      <div className="checkout-payment-grid">
        <div className="checkout-payment-main">
          <header className="checkout-payment-main__intro">
            {ctx?.order_id ? (
              <p className="dangbae-payment-intro">
                주문 <strong className="dangbae-payment-order-id">#{ctx.order_id}</strong>이(가) 접수되었습니다.
                아래에서 결제 방법을 선택하여 진행해 주세요.
              </p>
            ) : (
              <p className="dangbae-payment-intro">
                배송을 먼저 신청하면 주문 번호와 금액이 자동으로 채워집니다.
              </p>
            )}
          </header>

          <section className="checkout-detail-card" aria-label="배송 상세">
            <div className="checkout-detail-row">
              <span className="checkout-detail-row__label">물품</span>
              <strong className="checkout-detail-row__value">{itemTitle}</strong>
            </div>
            <div className="checkout-detail-route">
              <span className="checkout-detail-route__title">이동 경로</span>
              <p className="checkout-detail-route__line">
                <span className="checkout-detail-route__point">출발</span>
                <span className="checkout-detail-route__text">{originLabel}</span>
              </p>
              <p className="checkout-detail-route__line">
                <span className="checkout-detail-route__point">도착</span>
                <span className="checkout-detail-route__text">{destLabel}</span>
              </p>
            </div>
          </section>

          <section className="checkout-payment-panel-card" aria-labelledby="dangbae-payment-page-title">
            <h3 id="dangbae-payment-page-title" className="visually-hidden">
              결제 정보
            </h3>
            <DangbaePaymentPanel
              estimatedFare={estimatedFare}
              paymentAmount={paymentAmount}
              paymentOrderName={paymentOrderName}
              payMethod={payMethod}
              meetPayType={meetPayType}
              lastPrepare={lastPrepare}
              onPaymentAmountChange={setPaymentAmount}
              onPayMethodChange={setPayMethod}
              onMeetPayTypeChange={setMeetPayType}
              onApplyEstimatedFare={applyEstimatedFare}
              onConfirmBankTransfer={handleConfirmBankTransfer}
              onConfirmMeetPay={handleConfirmMeetPay}
              fareHintMode={ctx?.order_id ? 'after-order' : 'default'}
              layoutCheckout
            />
          </section>
        </div>

        <aside className="checkout-payment-sidebar" aria-label="주문 요약">
          <div className="checkout-summary-card">
            <div className="checkout-summary-card__head">
              <span className="checkout-summary-card__head-icon" aria-hidden="true">📦</span>
              <div className="checkout-summary-card__head-text">
                <span className="checkout-summary-card__kicker">주문 요약</span>
                {ctx?.order_id ? (
                  <span className="checkout-summary-card__order-id">예약 #{ctx.order_id}</span>
                ) : (
                  <span className="checkout-summary-card__order-id muted">주문 번호 대기</span>
                )}
              </div>
            </div>
            <dl className="checkout-summary-rows">
              <div className="checkout-summary-row">
                <dt>결제명</dt>
                <dd>{paymentOrderName || '당배 배송비'}</dd>
              </div>
              <div className="checkout-summary-row checkout-summary-row--amount">
                <dt>결제 금액</dt>
                <dd>
                  <strong>{displayAmount.toLocaleString()}</strong>
                  <span className="checkout-summary-won">원</span>
                </dd>
              </div>
              <div className="checkout-summary-row">
                <dt>결제 수단</dt>
                <dd>{payMethod === 'bank_transfer' ? '🏦 계좌이체' : '🤝 만나서 결제'}</dd>
              </div>
              {emailForBuyer ? (
                <div className="checkout-summary-row">
                  <dt>이메일</dt>
                  <dd className="checkout-summary-row__ellipsis">{emailForBuyer}</dd>
                </div>
              ) : null}
              {ctx?.user_phone ? (
                <div className="checkout-summary-row">
                  <dt>연락처</dt>
                  <dd>{ctx.user_phone}</dd>
                </div>
              ) : null}
            </dl>
            <p className="checkout-summary-secure">
              <span aria-hidden="true">🔒</span> 계좌이체 또는 만나서 결제로 안전하게 거래합니다.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
