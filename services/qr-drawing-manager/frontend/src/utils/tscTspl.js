/**
 * TSC TSPL/TSPL2 — 선택 도면 QR용 라벨 명령 생성.
 * 좌측 QR(가운데 정렬), 우측 ASCII 텍스트(프린터 인코딩 호환).
 * 좌표는 프린터 DPI(dot) 기준 — VITE_TSPL_DPI는 실제 장치와 맞출 것.
 */
const LF = '\r\n'

function escapeTsplQuoted(s) {
  return String(s)
    .replace(/[\r\n\x00]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}

/** 비트맵 폰트용: 출력 깨짐 방지(한글 등은 제거·치환) */
function asciiForTsplText(s, max = 40) {
  const t = String(s || '')
    .trim()
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\s+/g, ' ')
  return t.length <= max ? t : `${t.slice(0, max - 1)}?`
}

function tsplDotsPerMm() {
  const dpi = Number(import.meta.env?.VITE_TSPL_DPI) > 0 ? Number(import.meta.env.VITE_TSPL_DPI) : 203
  return dpi / 25.4
}

function mmToDots(n) {
  return Math.max(0, Math.round(Number(n) * tsplDotsPerMm()))
}

function labelSizeMm() {
  const w = Number(import.meta.env?.VITE_TSPL_LABEL_W_MM)
  const h = Number(import.meta.env?.VITE_TSPL_LABEL_H_MM)
  const wMm = Number.isFinite(w) && w > 0 ? w : 40
  const hMm = Number.isFinite(h) && h > 0 ? h : 40
  return { wMm, hMm }
}

function envNum(key, fallback) {
  const v = Number(import.meta.env?.[key])
  return Number.isFinite(v) && v >= 0 ? v : fallback
}

function gapLine() {
  const raw = import.meta.env?.VITE_TSPL_GAP_MM
  if (raw === '0' || raw === 0) return 'GAP 0,0'
  const gap = Number(raw)
  const gapMm = raw !== undefined && raw !== '' && Number.isFinite(gap) && gap >= 0 ? gap : 2
  if (gapMm === 0) return 'GAP 0,0'
  return `GAP ${gapMm} mm,0`
}

function truncateDrawingName(s, max = 36) {
  const t = String(s || '').trim()
  if (!t) return ''
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

/**
 * QR 데이터 길이로 모듈 수(대략) 추정 — TSC QRCODE 셀·위치 계산용
 */
function estimateQrModules(charLen) {
  if (charLen <= 14) return 21
  if (charLen <= 26) return 25
  if (charLen <= 42) return 29
  if (charLen <= 60) return 33
  return 37
}

function useLegacyLayout() {
  return import.meta.env?.VITE_TSPL_LEGACY_LAYOUT === '1' || import.meta.env?.VITE_TSPL_LEGACY_LAYOUT === 'true'
}

function useKoreanText() {
  return import.meta.env?.VITE_TSPL_KOREAN_TEXT === '1' || import.meta.env?.VITE_TSPL_KOREAN_TEXT === 'true'
}

/**
 * @param {object} opts
 * @param {string} opts.qrString — QR 페이로드 (화면·인쇄 동일해야 함)
 * @param {string} [opts.drawingName]
 * @param {string} [opts.pageLabel]
 * @param {string} [opts.categoryLabel]
 * @param {0|1} [opts.direction]
 */
export function buildTsplQrLabelCommands({
  qrString,
  drawingName = '',
  pageLabel = '',
  categoryLabel = '',
  direction: directionOpt,
}) {
  const rawQr = String(qrString || '').trim()
  const q = escapeTsplQuoted(rawQr)

  const nameRaw = truncateDrawingName(drawingName)
  const pageRaw = String(pageLabel || '').trim()
  const catRaw = String(categoryLabel || '').trim()

  const name = escapeTsplQuoted(useKoreanText() ? nameRaw : asciiForTsplText(nameRaw, 36))
  const page = escapeTsplQuoted(useKoreanText() ? pageRaw : asciiForTsplText(pageRaw, 24))
  const cat = escapeTsplQuoted(useKoreanText() ? catRaw : asciiForTsplText(catRaw, 20))

  const { wMm, hMm } = labelSizeMm()
  const dpi = Number(import.meta.env?.VITE_TSPL_DPI) > 0 ? Number(import.meta.env.VITE_TSPL_DPI) : 203
  const dpm = dpi / 25.4
  const wDots = Math.round(wMm * dpm)
  const hDots = Math.round(hMm * dpm)

  let direction = 0
  if (import.meta.env?.VITE_TSPL_DIRECTION !== undefined && import.meta.env?.VITE_TSPL_DIRECTION !== '') {
    direction = Number(import.meta.env.VITE_TSPL_DIRECTION) === 1 ? 1 : 0
  } else if (directionOpt !== undefined && directionOpt !== null) {
    direction = Number(directionOpt) === 1 ? 1 : 0
  }

  const mirror =
    import.meta.env?.VITE_TSPL_MIRROR === '1' || import.meta.env?.VITE_TSPL_MIRROR === 'true' ? 1 : 0

  let qrX
  let qrY
  let qrCell
  let textX
  let y1
  let y2
  let y3

  if (useLegacyLayout()) {
    qrX = mmToDots(envNum('VITE_TSPL_QR_X_MM', 3))
    qrY = mmToDots(envNum('VITE_TSPL_QR_Y_MM', 3.5))
    qrCell = Math.max(1, Math.min(10, Math.round(envNum('VITE_TSPL_QR_CELL', 2))))
    textX = mmToDots(envNum('VITE_TSPL_TEXT_X_MM', 17))
    y1 = mmToDots(envNum('VITE_TSPL_TEXT_Y1_MM', 3.5))
    y2 = mmToDots(envNum('VITE_TSPL_TEXT_Y2_MM', 9))
    y3 = mmToDots(envNum('VITE_TSPL_TEXT_Y3_MM', 14.5))
  } else {
    qrCell = Math.max(3, Math.min(8, Math.round(envNum('VITE_TSPL_QR_CELL', 4))))
    const modules = estimateQrModules(rawQr.length)
    let qrSize = modules * qrCell
    const margin = mmToDots(1.5)
    const leftZoneW = Math.round(wDots * 0.4)
    const maxQr = Math.min(leftZoneW - margin, hDots - margin * 2)
    if (qrSize > maxQr && modules > 0) {
      qrCell = Math.max(3, Math.floor(maxQr / modules))
      qrSize = modules * qrCell
    }
    qrX = margin
    qrY = Math.max(margin, Math.round((hDots - qrSize) / 2))
    textX = Math.round(wDots * 0.42)
    const lineGap = Math.round(mmToDots(2.8))
    const textBlock = lineGap * 2 + mmToDots(9)
    const textTop = Math.max(margin, Math.round((hDots - textBlock) / 2))



    //fixed
    qrCell = 9
    qrX = 0
    qrY = 25
    textX = 300
    y1 = textTop

    y2 = y1 + lineGap
    y3 = y2 + lineGap

    
  }

  let cmds = ''
  cmds += `SIZE ${wMm} mm, ${hMm} mm` + LF
  cmds += gapLine() + LF
  cmds += mirror ? `DIRECTION ${direction},${mirror}` + LF : `DIRECTION ${direction}` + LF
  cmds += 'REFERENCE 0,0' + LF
  cmds += 'CLS' + LF
  cmds += `QRCODE ${qrX},${qrY},M,${qrCell},A,0,"${q}"` + LF
  if (name) cmds += `TEXT ${textX},${y1},"2",0,1,1,"${name}"` + LF
  if (page) cmds += `TEXT ${textX},${y2},"2",0,1,1,"${page}"` + LF
  if (cat) cmds += `TEXT ${textX},${y3},"2",0,1,1,"${cat}"` + LF
  cmds += 'PRINT 1' + LF
  alert(q)
  return cmds
}

export function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`)
    if (existing) {
      if (existing.getAttribute('data-loaded') === '1') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error(`load fail: ${src}`)))
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.setAttribute('data-src', src)
    s.onload = () => {
      s.setAttribute('data-loaded', '1')
      resolve()
    }
    s.onerror = () => reject(new Error(`load fail: ${src}`))
    document.head.appendChild(s)
  })
}

const JSPM_SCRIPT_URL = typeof import.meta !== 'undefined' && import.meta.env?.VITE_JSPM_SCRIPT_URL
  ? String(import.meta.env.VITE_JSPM_SCRIPT_URL)
  : '/js/JSPrintManager.js'

export async function ensureJsPrintManager() {
  await loadScriptOnce(JSPM_SCRIPT_URL)
  const g = typeof window !== 'undefined' ? window : {}
  if (g.__SAGOHUB_JSPM_PLACEHOLDER__) {
    throw new Error('JSPM_PLACEHOLDER')
  }
  const JSPM = g.JSPM
  if (!JSPM || !JSPM.JSPrintManager) {
    throw new Error('JSPrintManager.js 가 로드되지 않았습니다. public/js/JSPrintManager.js 를 배치하세요.')
  }
  JSPM.JSPrintManager.auto_reconnect = true
  if (JSPM.JSPrintManager.websocket_status === JSPM.WSStatus.Open) {
    return JSPM
  }
  JSPM.JSPrintManager.start()
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    const st = JSPM.JSPrintManager.websocket_status
    if (st === JSPM.WSStatus.Open) return JSPM
    if (st === JSPM.WSStatus.Blocked) throw new Error('JSPM_BLOCKED')
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('JSPM_TIMEOUT')
}

export async function jspmGetPrinters() {
  const JSPM = await ensureJsPrintManager()
  const list = await JSPM.JSPrintManager.getPrinters()
  return Array.isArray(list) ? list : []
}

export async function jspmSendRawTspl({ commands, useDefaultPrinter = true, printerName = '' }) {
  const JSPM = await ensureJsPrintManager()
  const cpj = new JSPM.ClientPrintJob()
  if (useDefaultPrinter) {
    cpj.clientPrinter = new JSPM.DefaultPrinter()
  } else {
    if (!printerName) throw new Error('프린터를 선택하세요.')
    cpj.clientPrinter = new JSPM.InstalledPrinter(printerName)
  }
  cpj.printerCommands = commands
  const ret = cpj.sendToClient()
  if (ret && typeof ret.then === 'function') await ret
}
