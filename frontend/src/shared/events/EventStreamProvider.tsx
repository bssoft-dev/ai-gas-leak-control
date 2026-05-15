import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { OpenAPI } from '../../api/core/OpenAPI'

type StreamStatus = 'connecting' | 'open' | 'closed' | 'error'

type StreamEvent = {
  type: string
  payload: any
  raw: any
}

type PendingWaiter = {
  type: string
  matcher?: (payload: any) => boolean
  resolve: (event: StreamEvent) => void
  reject: (error: Error) => void
}

type EventStreamContextValue = {
  status: StreamStatus
  lastEvent: StreamEvent | null
  waitForEvent: (type: string, matcher?: (payload: any) => boolean, timeoutMs?: number) => Promise<StreamEvent>
}

const KNOWN_EVENT_TYPES = [
  'GAS_LEAK_EMERGENCY_STOP_RESULT',
  'GAS_LEAK_VALVE_RESET_RESULT',
  'GAS_LEAK_DRAWING_UPLOADED',
  'GAS_LEAK_DRAWING_DELETED',
  'GAS_LEAK_SENSORS_SAVED',
  'GAS_LEAK_STATUS_RESULT',
  'GAS_LEAK_MES_STATUS_RESULT',
  'GAS_LEAK_ALARM_CONTROL_RESULT',
  'GAS_LEAK_CALL_MANAGER_RESULT',
] as const

const EventStreamContext = createContext<EventStreamContextValue | null>(null)

function normalizeEvent(eventType: string, raw: any): StreamEvent {
  const payload = raw && typeof raw === 'object' && 'payload' in raw ? raw.payload : raw
  return {
    type: eventType || (raw && typeof raw === 'object' ? String(raw.type ?? 'message') : 'message'),
    payload,
    raw,
  }
}

function parseEventData(data: string) {
  if (!data) return null
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

export function EventStreamProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StreamStatus>('connecting')
  const [lastEvent, setLastEvent] = useState<StreamEvent | null>(null)
  const waitersRef = useRef<PendingWaiter[]>([])

  const dispatchEvent = useCallback((event: StreamEvent) => {
    setLastEvent(event)
    const matched: PendingWaiter[] = []

    waitersRef.current = waitersRef.current.filter((waiter) => {
      if (waiter.type !== event.type) return true
      if (waiter.matcher && !waiter.matcher(event.payload)) return true
      matched.push(waiter)
      return false
    })

    matched.forEach((waiter) => waiter.resolve(event))
  }, [])

  useEffect(() => {
    const streamUrl = `${OpenAPI.BASE}/api/events/stream`
    const eventSource = new EventSource(streamUrl)

    const onOpen = () => setStatus('open')
    const onError = () => setStatus('error')
    const onMessage = (event: MessageEvent) => {
      const parsed = parseEventData(event.data)
      if (parsed == null) return
      const normalizedType =
        parsed && typeof parsed === 'object' && 'type' in parsed ? String(parsed.type ?? 'message') : 'message'
      dispatchEvent(normalizeEvent(normalizedType, parsed))
    }

    setStatus('connecting')
    eventSource.onopen = onOpen
    eventSource.onerror = onError
    eventSource.onmessage = onMessage

    const namedListeners = KNOWN_EVENT_TYPES.map((eventType) => {
      const handler = (event: Event) => {
        const messageEvent = event as MessageEvent
        const parsed = parseEventData(messageEvent.data)
        dispatchEvent(normalizeEvent(eventType, parsed))
      }
      eventSource.addEventListener(eventType, handler)
      return { eventType, handler }
    })

    return () => {
      namedListeners.forEach(({ eventType, handler }) => {
        eventSource.removeEventListener(eventType, handler)
      })
      eventSource.close()
      setStatus('closed')
    }
  }, [dispatchEvent])

  const waitForEvent = useCallback(
    (type: string, matcher?: (payload: any) => boolean, timeoutMs = 8000) =>
      new Promise<StreamEvent>((resolve, reject) => {
        const waiter: PendingWaiter = { type, matcher, resolve, reject }
        waitersRef.current.push(waiter)

        const timeoutId = window.setTimeout(() => {
          waitersRef.current = waitersRef.current.filter((entry) => entry !== waiter)
          reject(new Error(`${type} event timeout`))
        }, timeoutMs)

        waiter.resolve = (event) => {
          window.clearTimeout(timeoutId)
          resolve(event)
        }

        waiter.reject = (error) => {
          window.clearTimeout(timeoutId)
          reject(error)
        }
      }),
    [],
  )

  const value = useMemo<EventStreamContextValue>(
    () => ({
      status,
      lastEvent,
      waitForEvent,
    }),
    [lastEvent, status, waitForEvent],
  )

  return <EventStreamContext.Provider value={value}>{children}</EventStreamContext.Provider>
}

export function useEventStream() {
  const context = useContext(EventStreamContext)
  if (!context) {
    throw new Error('useEventStream must be used within EventStreamProvider')
  }
  return context
}
