import React from 'react'

type Props = {
  children: React.ReactNode
}

type State = {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // 콘솔에 남겨 원인 추적
    console.error(error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-white p-6">
          <div className="mx-auto w-full max-w-[900px] rounded-[12px] border border-[#e2e8f0] bg-white p-6 shadow-sm">
            <div className="font-['Pretendard',sans-serif] text-[16px] font-semibold text-[#0b1828]">
              화면 렌더링 중 오류가 발생했습니다.
            </div>
            <div className="mt-3 whitespace-pre-wrap rounded-[10px] bg-[#0b1828] p-4 font-mono text-[12px] leading-[1.5] text-white">
              {String(this.state.error?.stack ?? this.state.error?.message ?? 'Unknown error')}
            </div>
            <button
              type="button"
              className="mt-5 h-[40px] rounded-[10px] bg-[#1392ec] px-4 font-['Pretendard',sans-serif] text-[14px] font-medium text-white"
              onClick={() => window.location.reload()}
            >
              새로고침
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

