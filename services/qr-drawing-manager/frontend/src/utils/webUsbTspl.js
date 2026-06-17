/**
 * WebUSB로 TSC TSPL/TSPL2 텍스트를 USB 프린터에 전송합니다.
 * - 이미 허가된 장치는 navigator.usb.getDevices()로 재사용하여 매번 권한 창을 띄우지 않습니다.
 * - Bulk OUT은 엔드포인트 packetSize 단위로 나누어 전송합니다(잘린 TSPL로 다른 QR이 찍히는 문제 방지).
 */

const STORAGE_KEY_SERIAL = 'sagohub_webusb_printer_serial'

function parseHexId(v) {
  if (v == null || v === '') return undefined
  const s = String(v).trim()
  const n = parseInt(s.startsWith('0x') || s.startsWith('0X') ? s : `0x${s}`, 16)
  return Number.isFinite(n) ? n : undefined
}

function deviceMatchesFilter(device, vid, pid) {
  if (vid != null && device.vendorId !== vid) return false
  if (pid != null && device.productId !== pid) return false
  return true
}

function preferStoredSerial(devices) {
  if (!devices.length) return null
  let stored = ''
  try {
    stored = sessionStorage.getItem(STORAGE_KEY_SERIAL) || ''
  } catch (_) {}
  if (stored) {
    const hit = devices.find((d) => (d.serialNumber || '') === stored)
    if (hit) return hit
  }
  return devices[0]
}

export function isWebUsbSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.usb !== 'undefined'
}

function findBulkOutEndpoint(device) {
  const cfg = device.configuration
  if (!cfg?.interfaces?.length) return null
  for (const iface of cfg.interfaces) {
    const alts = iface.alternates || []
    for (const alt of alts) {
      const eps = alt.endpoints || []
      for (const ep of eps) {
        if (ep.type === 'bulk' && ep.direction === 'out') {
          return {
            interfaceNumber: iface.interfaceNumber,
            alternateSetting: alt.alternateSetting,
            endpointNumber: ep.endpointNumber,
            packetSize: ep.packetSize && ep.packetSize > 0 ? ep.packetSize : 64,
          }
        }
      }
    }
  }
  return null
}

function getEndpointPacketSize(device, endpointNumber) {
  const cfg = device.configuration
  if (!cfg?.interfaces?.length) return 64
  for (const iface of cfg.interfaces) {
    for (const alt of iface.alternates || []) {
      for (const ep of alt.endpoints || []) {
        if (ep.endpointNumber === endpointNumber && ep.packetSize > 0) return ep.packetSize
      }
    }
  }
  return 64
}

/**
 * 이미 이 출처(origin)에서 허가된 USB 프린터 목록(대화상자 없음).
 * @returns {Promise<USBDevice[]>}
 */
export async function getAuthorizedUsbPrinters() {
  if (!isWebUsbSupported()) return []
  try {
    return await navigator.usb.getDevices()
  } catch (_) {
    return []
  }
}

/**
 * 사용자 제스처(클릭)가 있을 때만 호출: 장치 선택 창을 띄워 프린터를 등록합니다.
 * 이후에는 getAuthorizedUsbPrinters() / 인쇄 경로가 같은 장치를 재사용합니다.
 */
export async function pairWebUsbLabelPrinter() {
  if (!isWebUsbSupported()) {
    throw new Error('WEBUSB_UNSUPPORTED')
  }
  try {
    const dev = await requestNewUsbDevice()
    try {
      if (dev.serialNumber) sessionStorage.setItem(STORAGE_KEY_SERIAL, dev.serialNumber)
    } catch (_) {}
    return dev
  } catch (e) {
    if (e && e.name === 'NotFoundError') throw new Error('WEBUSB_CANCELLED')
    throw e
  }
}

async function requestNewUsbDevice() {
  const vid = parseHexId(typeof import.meta !== 'undefined' ? import.meta.env?.VITE_WEBUSB_VENDOR_ID : undefined)
  const pid = parseHexId(typeof import.meta !== 'undefined' ? import.meta.env?.VITE_WEBUSB_PRODUCT_ID : undefined)

  if (vid != null) {
    const filter = { vendorId: vid }
    if (pid != null) filter.productId = pid
    return navigator.usb.requestDevice({ filters: [filter] })
  }

  try {
    return await navigator.usb.requestDevice({ filters: [], acceptAllDevices: true })
  } catch (e) {
    if (e && e.name === 'TypeError') {
      throw new Error('WEBUSB_ACCEPT_ALL_UNSUPPORTED')
    }
    throw e
  }
}

/**
 * 인쇄용: 먼저 허가 목록에서 찾고, 없을 때만 requestDevice(첫 연결·인쇄 버튼 클릭 시).
 */
async function acquireLabelDevice() {
  const vid = parseHexId(typeof import.meta !== 'undefined' ? import.meta.env?.VITE_WEBUSB_VENDOR_ID : undefined)
  const pid = parseHexId(typeof import.meta !== 'undefined' ? import.meta.env?.VITE_WEBUSB_PRODUCT_ID : undefined)

  const granted = await navigator.usb.getDevices()
  const matched = granted.filter((d) => deviceMatchesFilter(d, vid, pid))
  if (matched.length) {
    return preferStoredSerial(matched)
  }

  try {
    const dev = await requestNewUsbDevice()
    try {
      if (dev.serialNumber) sessionStorage.setItem(STORAGE_KEY_SERIAL, dev.serialNumber)
    } catch (_) {}
    return dev
  } catch (e) {
    if (e && e.name === 'NotFoundError') throw new Error('WEBUSB_CANCELLED')
    throw e
  }
}

async function transferOutChunked(device, endpointNumber, data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data)
  const packetSize = getEndpointPacketSize(device, endpointNumber)
  for (let off = 0; off < u8.length; off += packetSize) {
    const chunk = u8.subarray(off, Math.min(off + packetSize, u8.length))
    const result = await device.transferOut(endpointNumber, chunk)
    const st = result && result.status
    if (st && st !== 'ok') {
      throw new Error(`WEBUSB_TRANSFER_${String(st)}`)
    }
  }
}

/**
 * @param {string} commands TSPL 원문(개행은 \n 또는 \r\n)
 */
export async function sendTsplViaWebUSB(commands) {
  if (!isWebUsbSupported()) {
    throw new Error('WEBUSB_UNSUPPORTED')
  }

  let device
  try {
    device = await acquireLabelDevice()
  } catch (e) {
    if (e && e.message === 'WEBUSB_CANCELLED') throw e
    if (e && e.name === 'NotFoundError') throw new Error('WEBUSB_CANCELLED')
    throw e
  }

  const payload = commands.includes('\r\n') ? commands : commands.replace(/\r?\n/g, '\r\n')
  const data = new TextEncoder().encode(payload)

  await device.open()
  try {
    const configs = device.configurations?.length
      ? device.configurations.map((c) => c.configurationValue)
      : [1]

    for (const cv of configs) {
      await device.selectConfiguration(cv)
      const picked = findBulkOutEndpoint(device)
      if (!picked) continue
      try {
        await device.claimInterface(picked.interfaceNumber)
      } catch (_) {
        continue
      }
      try {
        if (picked.alternateSetting != null && picked.alternateSetting !== 0) {
          await device.selectAlternateInterface(picked.interfaceNumber, picked.alternateSetting)
        }
        await transferOutChunked(device, picked.endpointNumber, data)
      } finally {
        try {
          await device.releaseInterface(picked.interfaceNumber)
        } catch (_) {}
      }
      return
    }
    throw new Error('WEBUSB_NO_BULK_OUT')
  } finally {
    try {
      await device.close()
    } catch (_) {}
  }
}
