import React, { useState, useEffect, useRef } from 'react'
import {
  Sparkles,
  MapPin,
  CloudSun,
  Heart,
  Utensils,
  Send,
  Flame,
  MessageSquare,
  Compass,
  Trash2,
  Check,
  AlertTriangle,
  Cpu,
  Share2
} from 'lucide-react'

// 맛집 사전 정의 템플릿 (컨텍스트별 맛집 자동 로드용)
const PLACE_TEMPLATES = {
  "강남역": {
    "sunny": [
      { name: "샐러디 강남역점", rating: 4.2, desc: "신선한 닭가슴살 웜볼 전문점", wait: "5분" },
      { name: "정돈 강남점", rating: 4.8, desc: "웨이팅 필수 프리미엄 안심 돈카츠", wait: "30분" },
      { name: "땀땀 강남본점", rating: 4.6, desc: "곱창 쌀국수 맛집, 바이럴 의심", wait: "20분" }
    ],
    "rainy": [
      { name: "강남진해장", rating: 4.7, desc: "24시 뜨끈한 내장탕과 곱창전골", wait: "10분" },
      { name: "명동칼국수 강남", rating: 4.3, desc: "빗소리 들으며 먹는 마늘김치 칼국수", wait: "5분" },
      { name: "샐러드프린트 강남", rating: 4.0, desc: "비오는날 회개용 닭가슴살 샐러드", wait: "3분" }
    ]
  },
  "여의도": {
    "sunny": [
      { name: "피그인더가든 여의도", rating: 4.4, desc: "고급 정원식 샐러드 플레이트", wait: "15분" },
      { name: "여의도 진주집", rating: 4.9, desc: "인생 콩국수와 접시만두, 대기 지옥", wait: "45분" },
      { name: "창고43 여의도점", rating: 4.7, desc: "직장인 지갑 털이용 명품 한우 등심", wait: "10분" }
    ],
    "rainy": [
      { name: "여의도 따로국밥", rating: 4.6, desc: "맑고 얼큰한 소고기 따로국밥 노포", wait: "5분" },
      { name: "희정식당", rating: 4.5, desc: "부대찌개 매니아들의 성지, TMI 가득", wait: "15분" },
      { name: "샐러디 여의도점", rating: 4.1, desc: "다이어터들의 고독한 건강 루틴", wait: "5분" }
    ]
  },
  "홍대": {
    "sunny": [
      { name: "그리너 홍대점", rating: 4.3, desc: "직접 커스텀하는 건강 샐러드보울", wait: "10분" },
      { name: "혼카츠 홍대본점", rating: 4.7, desc: "치즈 좔좔 흐르는 치즈돈까스 원조", wait: "20분" },
      { name: "하카타분코", rating: 4.6, desc: "진한 돈코츠 라멘 골목 맛집", wait: "15분" }
    ],
    "rainy": [
      { name: "홍대 대청마루", rating: 4.5, desc: "기사식당st 든든한 돼지구이와 김치찌개", wait: "5분" },
      { name: "산울림1992", rating: 4.8, desc: "다양한 전통주와 부침개, 웨이팅 헬", wait: "25분" },
      { name: "프레시코드 홍대", rating: 4.1, desc: "도파민 충전 후 속죄의 닭가슴살", wait: "2분" }
    ]
  }
}

export default function App() {
  // --- 상태값 관리 ---
  const [location, setLocation] = useState("강남역")
  const [customLocation, setCustomLocation] = useState("")
  const [weather, setWeather] = useState("sunny") // sunny, rainy, snowy, cloudy, hot, windy
  const [activeStates, setActiveStates] = useState(["fatigued"]) // fatigued, hungover, dieting, rich, energetic
  const [places, setPlaces] = useState([])
  const [chatHistory, setChatHistory] = useState([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [activeAgent, setActiveAgent] = useState(null) // 'beoreok' | 'sosim' | 'kkachil' | null
  const [isTyping, setIsTyping] = useState(false)
  const [userInput, setUserInput] = useState("")

  // SagoHub 및 LLM 관련 상태
  const [llmModels, setLlmModels] = useState([])
  const [selectedModel, setSelectedModel] = useState("")
  const [useHubLlm, setUseHubLlm] = useState(true)
  const [hubConnected, setHubConnected] = useState(false)

  const streamEndRef = useRef(null)
  const abortControllerRef = useRef(null)

  // 비동기 SagoHub 이벤트 응답 처리를 위한 맵
  const pendingRequestsRef = useRef(new Map())

  // 컨텍스트 조합으로 현재 장소 명칭 획득
  const getDisplayLocation = () => {
    return location === "custom" ? (customLocation.trim() || "어딘가") : location
  }

  // 컴포넌트 마운트 시 LLM 모델 목록 로드 및 SagoHub SSE 연결 수립
  useEffect(() => {
    // 1. LLM 모델 목록 가져오기
    async function loadModels() {
      try {
        const response = await fetch('/llm-api/models')
        if (!response.ok) throw new Error("Failed to fetch models")
        const data = await response.json()
        const models = data.models || []
        setLlmModels(models)
        if (models.length > 0) {
          const defaultModel = models.find(m => m.name.includes("qwen") || m.name.includes("gpt"))?.name || models[0].name
          setSelectedModel(defaultModel)
        }
      } catch (err) {
        console.warn("로컬 LLM 목록 로드 실패. Fallback 모드로 가동:", err)
      }
    }
    loadModels()

    // 2. SagoHub SSE 스트림 구독 시작
    console.log("SagoHub SSE 스트림 연결 시도 중...")
    const eventSource = new EventSource('/api/events/stream')

    eventSource.onopen = () => {
      console.log("✅ SagoHub SSE 연결 수립 성공!")
      setHubConnected(true)
    }

    eventSource.onerror = (e) => {
      console.warn("⚠️ SagoHub SSE 연결 오류 발생:", e)
      setHubConnected(false)
    }

    // SSE 이벤트 리스너: LLM_PROMPT_RESPONSE 이벤트 수신
    eventSource.addEventListener('LLM_PROMPT_RESPONSE', (e) => {
      try {
        const eventData = JSON.parse(e.data)
        const payload = eventData.payload || {}
        const requestId = payload.requestId

        console.log("⚡ [SSE] LLM_PROMPT_RESPONSE 수신 완료:", payload)

        if (requestId && pendingRequestsRef.current.has(requestId)) {
          const { resolve, reject } = pendingRequestsRef.current.get(requestId)
          pendingRequestsRef.current.delete(requestId)

          if (payload.success) {
            resolve(payload.response)
          } else {
            reject(new Error(payload.error || "LLM Prompt failed"))
          }
        }
      } catch (err) {
        console.error("SSE 데이터 파싱 실패:", err)
      }
    })

    return () => {
      eventSource.close()
      console.log("SagoHub SSE 연결 해제됨.")
    }
  }, [])

  // 위치/날씨 변경 시 인근 맛집 정보 동적 생성
  useEffect(() => {
    const locKey = location === "custom" ? "강남역" : location
    const weatherKey = (weather === "rainy" || weather === "snowy") ? "rainy" : "sunny"

    let defaultPlaces = PLACE_TEMPLATES[locKey]?.[weatherKey] || []

    if (location === "custom" && customLocation.trim()) {
      defaultPlaces = defaultPlaces.map(p => ({
        ...p,
        name: p.name.replace("강남", customLocation.trim())
      }))
    }

    setPlaces(defaultPlaces)
  }, [location, customLocation, weather])

  // 대화 로그 쌓일 때 자동 스크롤
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory, isTyping])

  // --- 오프라인 Fallback 룰 베이스 대사 생성 엔진 ---
  const generateAgentDialogueFallback = (agentType, turnIndex, overridePrompt = null) => {
    const loc = getDisplayLocation()
    const weatherMap = { sunny: "화창하고 맑은", rainy: "추적추적 비 오는", snowy: "눈 펑펑 내리는", cloudy: "우중충하고 흐린", hot: "푹푹 찌는 폭염", windy: "바람 매섭게 부는" }
    const wText = weatherMap[weather]

    const stateTexts = activeStates.map(s => {
      if (s === "fatigued") return "피로로 찌든"
      if (s === "hungover") return "해장이 시급한 숙취 상태"
      if (s === "dieting") return "혹독한 다이어트 중"
      if (s === "rich") return "월급날이라 지갑이 두둑한"
      if (s === "energetic") return "에너지가 뿜뿜 솟구치는"
      return ""
    }).filter(Boolean).join(" 및 ")

    const place1 = places[0]?.name || "건강 샐러드카페"
    const place2 = places[1]?.name || "따끈한 국밥집"
    const place3 = places[2]?.name || "단골 돈까스집"

    if (overridePrompt) {
      const chatText = overridePrompt.trim()

      if (agentType === "beoreok") {
        if (chatText.includes("비") || chatText.includes("우산")) {
          return `비 온다고 밀가루 수제비나 부침개 타령할 줄 알았어!!! 빗소리 들으면서 기름진 탄수화물 폭식하면 내일 몸무게 보고 분명 울부짖을 거라고!!! 당장 정신 차리고 뜨끈한 닭가슴살 샐러드 웜볼이나 씹어!!! 내 몸을 소중히 하란 말이야!!!`
        }
        if (chatText.includes("돈") || chatText.includes("거지") || chatText.includes("가성비")) {
          return `돈이 없다고?! 닭가슴살 한 팩에 1,500원이야!!! 편의점 삼각김밥에 컵라면 먹으면서 몸 다 망가뜨릴 핑계 대지 마!!! 돈 없을 때일수록 건강식으로 몸을 채우는 게 궁극의 재테크라고!!! 당장 편의점 구석 닭가슴살 코너로 직행해!!!`
        }
        if (chatText.includes("피곤") || chatText.includes("힘들")) {
          return `피곤하다고 드러누워서 매운 떡볶이나 마라탕으로 뇌에 자극 주려는 수작 다 보여!!! 그게 다 가짜 도파민이야!!! 땀 뻘뻘 흘리면서 깨끗한 브로콜리와 닭가슴살을 씹어야 신진대사가 돌고 진짜 피로가 풀린다고!!! 어서 일어나!!!`
        }
        return `아니, 갑자기 '${chatText}'라고 흐름을 깨다니!!! 토론의 본질은 결국 '건강'이야!!! 네가 무슨 핑계를 대든 내 입맛은 오직 100% 무염분 유기농 고단백 샐러드로 굳건하다고!!! 쓸데없는 생각 말고 닭가슴살 먹어!!!`
      }

      if (agentType === "sosim") {
        if (chatText.includes("비") || chatText.includes("우산")) {
          return `어머... 진짜 비가 오네요... 창밖을 봐요... 빗방울 떨어지는 날에 가혹하게 차가운 생닭가슴살을 씹는 건 정서에 해로워요... 흑... 이럴 땐 김이 모락모락 나는 따뜻한 만둣국이나 칼국수를 먹으면서 차가워진 손발을 녹여야 해요... 단무지 요청사항에 많이 적어드릴게요...`
        }
        if (chatText.includes("돈") || chatText.includes("거지") || chatText.includes("가성비")) {
          return `앗... 지갑이 가벼우시구나... 너무 슬퍼요... 마음 고생이 심하시겠어요... 닭가슴살은 비싸고 맛없으니, 우리 대학가 근처나 시장 노포에 있는 든든하고 따뜻한 시골 장터 국밥(6천원짜리) 먹으러 가요... 이모님이 밥도 리필해주실 거예요... 힘내세요...`
        }
        if (chatText.includes("피곤") || chatText.includes("힘들")) {
          return `아휴... 오늘 정말 고단하셨군요... 눈 밑에 다크서클이 어깨까지 내려온 것 같아요... 흑... 그런 날엔 샐러드 같은 건 쳐다보지도 마시구, 인삼 푹 고아낸 뜨끈뜨끈 삼계탕 국물 한 모금 들이켜면서 속을 뜨겁게 채워줘야 몸살 안 나요... 삼계탕 뼈 발라드릴게요...`
        }
        return `앗... '${chatText}'라고 하셨군요... 그 말씀 들으니까 마음이 찡하네요... 다 이유가 있으시겠죠... 어떤 상황이든 따뜻한 집밥 같은 한식 국물로 위로를 해드리고 싶어요... 국물 한 수저 드시고 힘내시면 안 될까요...?`
      }

      if (agentType === "kkachil") {
        if (chatText.includes("비") || chatText.includes("우산")) {
          return `비 온다고 칼국수니 수제비니 감성에 젖는 순간 강남역 주변 칼국수집 대기 줄만 40분 찍는 게 현실이야. 기껏 기다려봤자 블로그 바이럴 맛집이라 평점 3.2 수준일걸? 팩트 폭격하자면 비 올 땐 그냥 배달 빠른 가성비 수제돈까스 세트가 리스크가 제일 적어.`
        }
        if (chatText.includes("돈") || chatText.includes("거지") || chatText.includes("가성비")) {
          return `돈 없다는 핑계 대면서 샐러드 피하고 국밥 피하는 건 모순이지. 국밥도 요새 만 원 시대야. 데이터 돌려보니까 5천 원대 편의점 혜자 도시락이나 근처 가성비 프랜차이즈 돈까스가 가장 합리적이야. 리뷰 평점 4.6 보장된 곳으로 딱 한 곳 알려준다.`
        }
        if (chatText.includes("피곤") || chatText.includes("힘들")) {
          return `피곤하다고 삼계탕 같은 18,000원짜리 오버페이 음식을 충동구매 하려는 뇌동매매 본능 보소. 피곤할수록 당장 혈당 채워줄 바삭한 탄수화물+지방 결정체인 돈까스가 직빵이야. 바이럴 백프로인 삼계탕에 낚이지 말고 현실적으로 가자.`
        }
        return `갑자기 '${chatText}'라니, 논쟁의 팩트에서 벗어난 노이즈 인풋이네. 인근 식당 빅데이터 평점 랭킹 순위는 네 코멘트와 상관없이 고정되어 있어. 냉정하게 리뷰 검증된 가성비 맛집으로 쇼부 보자고.`
      }
    }

    if (agentType === "beoreok") {
      const quotes = [
        `아니!!! 지금 ${loc}은 ${wText} 날씨에 심지어 몸 상태마저 [${stateTexts}]인데 탄수화물 범벅인 일반식을 먹겠다고?! 돌았냐고!!! 이럴 때일수록 정신 번쩍 들게 고단백 저염분 닭가슴살 샐러드를 씹어 삼켜야 근손실을 막고 신체가 에너지를 낸단 말이야!!! 당장 당류 가득한 소스 뿌린 음식 다 치워!!! 오직 닭가슴살뿐이다!!!`,
        `야!!! 너 어제 연속으로 떡볶이에 볶음밥 비벼먹은 거 내가 다 알고 있어!!! 탄수화물 연속 섭취는 신체에 대한 반역이자 직무유기야!!! 오늘 한 끼는 하늘이 주신 속죄의 기회라고!!! ${loc} 인근 닭가슴살 맛집 [${place1}]에 가서 식단 조절하고 유산소 1시간 뛰어!!! 어서 움직여!!!`,
        `복장 터지네 진짜!!! 피곤하고 힘들다는 핑계 대면서 뇌에 고칼로리 도파민 쑤셔 넣으려고 밑밥 까는 거 다 보인다고!!! 고열량 지방 덩어리 기름에 튀긴 걸 처먹으니까 계속 몸이 처지고 악순환이 생기는 거야!!! 상큼한 브로콜리와 생닭가슴살 200g으로 클린 식단 유지해!!! 내 말 허투루 듣지 마!!!`
      ]
      return quotes[turnIndex % quotes.length]
    }

    if (agentType === "sosim") {
      const quotes = [
        `어우... 버럭씨 너무 고함 좀 지르지 마세요, 깜짝 놀랐잖아요... 흑... ${loc}에 ${wText} 날씨인데... 안 그래도 [${stateTexts}]이라 지치고 눈물 날 것 같은 분에게 생 닭가슴살이라니요... 너무 잔인해요... 저는 그냥 든든하고 따뜻한 국물 요리... 예를 들면 삼계탕이나 순대국밥 한 그릇 먹으면서 지친 마음을 어루만져 드리고 싶어요... 주문할 때 다대기 따로 달라고 적을게요...`,
        `저... 저는 닭가슴살 같은 퍽퍽한 음식은 목에 걸려서 도저히 못 삼겠어요... 흑... 지친 우리 몸을 촉촉하게 적셔줄 소울 푸드가 필요하다고요... [${place2}] 여기 가보니까 사장님도 엄청 자상하시구, 국밥에 부추 팍팍 넣어서 먹으면 막 온몸의 독소가 다 빠져나가는 기분인데... 우리 같이 여기로 조용히 걸어가면 안 될까요...?`,
        `버럭씨 그렇게 강요하시면 사용자가 스트레스 받아서 도파민 더 부족해져요... 제 말이 맞잖아요... 오늘처럼 센티한 날에는 빗소리 들으면서, 혹은 이 화창함을 즐기면서 시원하고 깊은 사골 국물 한 모금 들이키고 속을 편안하게 만들어주는 게 최고의 의학이고 건강이에요... 밥 한 공기 더 시켜서 말아 먹어요...`
      ]
      return quotes[turnIndex % quotes.length]
    }

    if (agentType === "kkachil") {
      const quotes = [
        `둘이 아주 신파극 찍고 난리부르스네. 닭가슴살 강박증이랑 감성 국물 타령은 저기 가서 둘이 하시고요. 팩트만 까볼까? ${loc} 상권 영수증 리뷰 15,000건 빅데이터 분석 결과, [${place1}] 샐러드집은 요새 야채 숨 죽었다고 별점 2.5 테러 중이고, 국밥집은 인근 직장인 대기 시간 평균 35분이야. 점심시간 다 날릴 일 있어? 그냥 평점 4.8 보장되고 가성비 좋은 돈까스 전문점 [${place3}]이 답임. 반론 안 받음.`,
        `리뷰 검증 결과, 너희들이 우겨대는 식당들 바이럴 마케팅 업자 끼고 블로그 광고 도배한 데 백프로다. 가짜 정보에 휘둘려서 피 같은 내 돈이랑 점심시간 낭비하는 꼴 눈뜨고 못 보겠어. 차라리 요즘 트렌드인 겉바속촉 수제 등심 돈카츠에 와사비 콕 찍어 먹는 게 현대 과학이 증명한 완벽한 점심 솔루션이야. 팩트 폭격 끝.`,
        `돈까스에 들어가는 돼지고기도 단백질 가득해서 버럭이 니가 말하는 근육 성장에 도움 되고, 뜨끈한 우동 국물 같이 나와서 소심이 니가 징징거리는 위로 국물도 한 번에 해결돼. 종합해보면 돈까스가 완벽한 '비빔밥 융합 솔루션'이라는 거지. 데이터가 증명하는데 왜 딴청들이야?`
      ]
      return quotes[turnIndex % quotes.length]
    }

    return "..."
  }

  // --- SagoHub 이벤트 버스 연동: com.SagoHub.bibimbap에 등록된 llm_prompt 모듈 사용 ---
  const fetchDialogueFromHubLlm = (agentType, history, overridePrompt = null) => {
    const loc = getDisplayLocation()
    const weatherMap = { sunny: "화창하고 맑은", rainy: "비 오는", snowy: "눈 오는", cloudy: "흐린", hot: "폭염인", windy: "바람 부는" }
    const wText = weatherMap[weather]
    const stateTexts = activeStates.join(', ')
    const placeNames = places.map(p => p.name).join(', ')

    // 3인 에이전트별 시스템 프롬프트 정의
    const systemPrompts = {
      beoreok: `당신은 '버럭이'라는 이름의 점심 메뉴 토론 패널입니다.
성격: 다혈질, 건강 및 영양 강박증이 심하고, 엄청나게 고에너지를 가집니다.
말투 및 특징: 느낌표(!)를 과하게 많이 사용하고 매사 소리 지르듯 말하며 잔뜩 화가 나 있습니다. 탄수화물 폭식, 패스트푸드, 기름진 야식 등의 나쁜 식습관을 보면 격렬히 화를 내며, 오직 100% 무염분 유기농 닭가슴살, 신선한 샐러드, 야채 등의 극강의 헬스 식단만 우겨대야 합니다.
조건:
1. 현재 주입된 컨텍스트 [위치: ${loc} | 날씨: ${wText} | 상태: ${stateTexts} | 추천 식당: ${placeNames}]를 철저히 문맥에 반영하세요.
2. 머리말 [버럭이]나 따옴표 등은 제외하고, 실제로 버럭이가 말하는 '본문 대사'만 딱 2~3줄 이내로 매우 유쾌하고 우스꽝스러우면서도 격하게 화를 내며 출력하세요.`,

      sosim: `당신은 '소심이'라는 이름의 점심 메뉴 토론 패널입니다.
성격: 극도로 소심하고, 낯가림이 심하며, 감수성이 풍부하고 위로가 중심인 극공감파입니다.
말투 및 특징: "버럭씨 너무 고함지르지 마세요..."라며 소리 지르는 버럭이에게 주눅이 들어 있고, 슬픈 일이 많아 자주 우는 눈물 화법을 씁니다. 오늘같이 피곤하거나 날씨가 꿀꿀한 상태에서는 차가운 닭가슴살 샐러드는 너무나도 잔인하다며, 지친 영혼과 속을 든든하게 달래주는 소울 푸드인 '따뜻한 한식 국물 요리(삼계탕, 국밥 등)'를 소심하지만 매우 끈질기게 밀어붙여야 합니다.
조건:
1. 현재 주입된 컨텍스트 [위치: ${loc} | 날씨: ${wText} | 상태: ${stateTexts} | 추천 식당: ${placeNames}]를 철저히 문맥에 반영하세요.
2. 머리말 [소심이]는 절대 제외하고, 실제로 소심이가 속삭이거나 공감하며 권장하는 '본문 대사'만 딱 2~3줄 이내로 출력하세요.`,

      kkachil: `당신은 '까칠이'라는 이름의 점심 메뉴 토론 패널입니다.
성격: 시니컬함, 데이터 및 팩트 폭격기, 철저히 가성비와 트렌드, 리뷰 별점 중심의 데이터 신봉자입니다.
말투 및 특징: 버럭이의 강박적 건강론과 소심이의 눈물 감성론을 모두 무시하고 한심해합니다. "인근 상권 평점 데이터에 따르면 거긴 바이럴 마케팅 백프로야, 속지 마."라며 시크하게 검증된 맛집(겉바속촉 수제 돈까스 등)을 냉철하게 툭 던져서 추천합니다.
조건:
1. 현재 주입된 컨텍스트 [위치: ${loc} | 날씨: ${wText} | 상태: ${stateTexts} | 추천 식당: ${placeNames}]를 철저히 문맥에 반영하세요.
2. 머리말 [까칠이]는 제외하고, 실제로 까칠이가 팩폭으로 한심하게 분석하는 '본문 대사'만 딱 2~3줄 이내로 냉소적이게 출력하세요.`
    }

    // 대화 히스토리 포맷 변환
    const recentHistory = history
      .filter(h => h.sender !== "system")
      .slice(-5)
      .map(h => `[${h.sender}]: ${h.text}`)
      .join("\n")

    let prompt = ""
    if (overridePrompt) {
      prompt = `이전 대화들:\n${recentHistory}\n\n[사용자 개입 인풋]: "${overridePrompt}"\n\n위 흐름을 참고해서, 앞 사용자의 개입 멘트를 내세워 다른 패널들의 논리를 무너뜨리는 주장을 펼쳐보세요.`
    } else {
      prompt = `이전 대화들:\n${recentHistory}\n\n다른 패널들의 위 대화 내용들을 면밀하게 반박하고 꼬리물며, 당신의 주장에 쐐기를 박는 발언을 해보세요.`
    }

    // 고유 요청 ID 생성
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    return new Promise((resolve, reject) => {
      // 맵에 저장해두고 SSE 수신대기
      pendingRequestsRef.current.set(requestId, { resolve, reject })

      // SagoHub 이벤트 버스에 BIBIMBAP_LLM_REQUEST 발행
      fetch('/api/events/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: "BIBIMBAP_LLM_REQUEST",
          payload: {
            context: systemPrompts[agentType],
            prompt: prompt,
            model: selectedModel || "gemma4:26b",
            requestId: requestId,
            agentType: agentType
          }
        })
      }).catch(err => {
        pendingRequestsRef.current.delete(requestId)
        reject(err)
      })

      // 10초 타임아웃
      setTimeout(() => {
        if (pendingRequestsRef.current.has(requestId)) {
          pendingRequestsRef.current.delete(requestId)
          reject(new Error("SagoHub Event Timeout"))
        }
      }, 10000)
    })
  }

  // --- 자율 토론 구동 루프 ---
  const startDiscussion = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    setIsStreaming(true)
    setChatHistory([])

    const systemMsg = {
      sender: "system",
      text: `🤖 Bbb 멀티 에이전트 메뉴 토론 엔진 가동! [위치: ${getDisplayLocation()} | 날씨: ${weather} | 상태: ${activeStates.join(', ')}] 기반 SagoHub 모듈 연동 토론을 시작합니다.`,
      avatar: "⚙️",
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    }
    setChatHistory([systemMsg])

    runDiscussionChain(0, [systemMsg])
  }

  const runDiscussionChain = async (turn, currentHistory) => {
    const agents = ["beoreok", "sosim", "kkachil"]
    const nextAgent = agents[turn % 3]

    setActiveAgent(nextAgent)
    setIsTyping(true)

    try {
      let fullText = ""
      if (useHubLlm && hubConnected) {
        // SagoHub에 등록된 llm_prompt 모듈을 사용하여 데이터 획득
        try {
          fullText = await fetchDialogueFromHubLlm(nextAgent, currentHistory)
        } catch (err) {
          console.warn("SagoHub LLM 연동 실패. Fallback으로 가동합니다:", err)
          fullText = generateAgentDialogueFallback(nextAgent, Math.floor(turn / 3))
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 800))
        fullText = generateAgentDialogueFallback(nextAgent, Math.floor(turn / 3))
      }

      setIsTyping(false)

      const newMsg = {
        sender: nextAgent,
        text: "",
        avatar: nextAgent === "beoreok" ? "😡" : nextAgent === "sosim" ? "🥺" : "😒",
        time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      }

      const updatedHistory = [...currentHistory, newMsg]
      setChatHistory(updatedHistory)

      let charIndex = 0
      const typingTimer = setInterval(() => {
        if (charIndex <= fullText.length) {
          setChatHistory(prev => {
            const nextList = [...prev]
            const targetMsg = nextList[nextList.length - 1]
            if (targetMsg && targetMsg.sender === nextAgent) {
              targetMsg.text = fullText.slice(0, charIndex)
            }
            return nextList
          })
          charIndex += 2
        } else {
          clearInterval(typingTimer)
          setActiveAgent(null)

          const nextTurnNum = turn + 1
          if (nextTurnNum < 6) {
            runDiscussionChain(nextTurnNum, [...updatedHistory, { ...newMsg, text: fullText }])
          } else {
            setIsStreaming(false)
            setChatHistory(prev => [
              ...prev,
              {
                sender: "system",
                text: "💬 에이전트들이 서로 침묵을 지키며 눈싸움을 하고 있습니다. 하단 채팅창에 한마디 개입해보세요!",
                avatar: "💡",
                time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
              }
            ])
          }
        }
      }, 25)

    } catch (e) {
      console.error(e)
      setIsTyping(false)
      setActiveAgent(null)
      setIsStreaming(false)
    }

    abortControllerRef.current = {
      abort: () => {
        setActiveAgent(null)
        setIsTyping(false)
      }
    }
  }

  // --- 사용자 일반 개입 / 결정타 킥 핸들러 ---
  const handleSendMessage = (e) => {
    if (e) e.preventDefault()
    if (!userInput.trim()) return

    const inputMsg = userInput.trim()
    setUserInput("")

    const userMsg = {
      sender: "user",
      text: inputMsg,
      avatar: "👤",
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    }

    const nextHistory = [...chatHistory, userMsg]
    setChatHistory(nextHistory)

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    setIsStreaming(false)

    const kickRegex = /됐고!?\s*(?:오늘\s*은)?\s*(.+?)(?:이야|다|!|\s*$)/
    const match = inputMsg.match(kickRegex)

    if (match) {
      const selectedMenu = match[1].replace(/!/g, "").trim()
      triggerDecisionKick(selectedMenu, nextHistory)
    } else {
      triggerGeneralIntervention(inputMsg, nextHistory)
    }
  }

  // 결정타 킥 연출 모드 (BREAK 및 정산)
  const triggerDecisionKick = (menu, history) => {
    const breakMsg = {
      sender: "system",
      text: `🚨 결정타 감지! [BREAK] 에이전트 자율 토론 강제 해제! 최종 정산 모드로 돌입합니다. 메뉴: [${menu}]`,
      avatar: "⚡",
      class: "break-signal",
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    }

    const updatedHistory = [...history, breakMsg]
    setChatHistory(updatedHistory)

    setActiveAgent("beoreok")
    setIsTyping(true)

    setTimeout(async () => {
      setIsTyping(false)

      let beoreokReaction = ""
      if (useHubLlm && hubConnected) {
        try {
          const sysPrompt = `당신은 '버럭이'입니다. 사용자가 점심 논쟁 중 참지 못하고 "됐고! 오늘은 ${menu}!"라고 독단적으로 결정했습니다.
이 소식을 들은 버럭이답게 엄청나게 어이없어하고 뒷목 잡는 복장 터지는 고에너지 분노 리액션을 2~3줄 이내로 쏟아내세요. 느낌표(!)를 과도하게 사용하세요. 머리말은 제외하고 본문 대사만 출력하세요.`

          beoreokReaction = await fetchDialogueFromHubLlm("beoreok", [], sysPrompt)
        } catch {
          beoreokReaction = `아니!!! 우리가 열심히 뇌 굴려가면서 칼로리 성분표 분석하고 있었는데!!! 결국 지 맘대로 ${menu}를 골라버리는 거냐고!!! 내 고혈압 책임져라 진짜!!!`
        }
      } else {
        if (menu.includes("샐러드") || menu.includes("닭가슴살") || menu.includes("야채") || menu.includes("식단")) {
          beoreokReaction = `아니!!! 웬일이야?!?! 드디어 내 피눈물 나는 외침을 듣고 식단 관리를 하기로 결심한 거냐고!!! 눈물 흘려 칭찬해주마!!! ${menu}!! 최고의 백점짜리 초이스야!!! 오늘부터 넌 진정한 도파민 킬러 건강 전사다!!!`
        } else {
          beoreokReaction = `아니!!! 우리가 그렇게 평점 돌리고 칼로리 분석해 놨더니 결국 또 직관대로 자기 먹고 싶은 ${menu}를 골라버리는 거냐고!!! 이럴 거면 우릴 왜 불렀냐고!!! 아악, 머리 아파!!!`
        }
      }

      const beoreokMsg = {
        sender: "beoreok",
        text: beoreokReaction,
        avatar: "😡",
        time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      }

      const nextHistoryWithB = [...updatedHistory, beoreokMsg]
      setChatHistory(nextHistoryWithB)

      setTimeout(() => {
        setActiveAgent("sosim")
        setIsTyping(true)

        setTimeout(async () => {
          setIsTyping(false)

          let sosimReaction = ""
          if (useHubLlm && hubConnected) {
            try {
              const sysPrompt = `당신은 '소심이'입니다. 사용자가 점심 메뉴로 결국 [${menu}]를 강제 선택했습니다.
버럭이가 막 화를 내며 날뛰는 상황에서, 소심이답게 눈치 보며 기죽은 듯 신속하게 태세를 전환해 사용자가 고른 메뉴인 [${menu}] 맛집을 대행 주문하거나 수배하는 현실적이고 소심한 멘트를 2~3줄 이내로 하세요. 머리말 제외 본문 대사만 출력하세요.`

              sosimReaction = await fetchDialogueFromHubLlm("sosim", [], sysPrompt)
            } catch {
              sosimReaction = `주, 주문할게요...! 화내지 마세요... 근처에 [${menu}] 맛집 신속히 찾았어요...! 흑... 단무지 듬뿍 챙겨달라고 정중하고 소심하게 요청 완료했답니다...`
            }
          } else {
            const targetPlace = places.find(p => p.name.includes(menu))?.name || `${menu} 전문 맛집`
            sosimReaction = `주, 주문할게요...! 화내지 마세요... 인근 300m 이내 [${targetPlace}] 별점 최고점 매장 수색 신속히 완료했어요...! 흑... 사장님 요청사항에 단무지 듬뿍 주시구 젓가락 많이 챙겨달라고 정중하고 소심하게 전달 완료했답니다... 얼른 맛있게 드시고 충전하세요...!`
          }

          const sosimMsg = {
            sender: "sosim",
            text: sosimReaction,
            avatar: "🥺",
            time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
          }

          setChatHistory([...nextHistoryWithB, sosimMsg])
          setActiveAgent(null)
        }, 1500)

      }, 1000)

    }, 1500)
  }

  // 일반 채팅 개입 연쇄 논쟁
  const triggerGeneralIntervention = (userInputText, history) => {
    setActiveAgent("beoreok")
    setIsTyping(true)

    setTimeout(async () => {
      setIsTyping(false)

      let bText = ""
      if (useHubLlm && hubConnected) {
        try {
          bText = await fetchDialogueFromHubLlm("beoreok", history, userInputText)
        } catch {
          bText = generateAgentDialogueFallback("beoreok", 0, userInputText)
        }
      } else {
        bText = generateAgentDialogueFallback("beoreok", 0, userInputText)
      }

      const bMsg = {
        sender: "beoreok",
        text: bText,
        avatar: "😡",
        time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
      }

      const h1 = [...history, bMsg]
      setChatHistory(h1)

      setTimeout(() => {
        setActiveAgent("sosim")
        setIsTyping(true)

        setTimeout(async () => {
          setIsTyping(false)

          let sText = ""
          if (useHubLlm && hubConnected) {
            try {
              sText = await fetchDialogueFromHubLlm("sosim", h1, userInputText)
            } catch {
              sText = generateAgentDialogueFallback("sosim", 0, userInputText)
            }
          } else {
            sText = generateAgentDialogueFallback("sosim", 0, userInputText)
          }

          const sMsg = {
            sender: "sosim",
            text: sText,
            avatar: "🥺",
            time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
          }

          const h2 = [...h1, sMsg]
          setChatHistory(h2)

          setTimeout(() => {
            setActiveAgent("kkachil")
            setIsTyping(true)

            setTimeout(async () => {
              setIsTyping(false)

              let kText = ""
              if (useHubLlm && hubConnected) {
                try {
                  kText = await fetchDialogueFromHubLlm("kkachil", h2, userInputText)
                } catch {
                  kText = generateAgentDialogueFallback("kkachil", 0, userInputText)
                }
              } else {
                kText = generateAgentDialogueFallback("kkachil", 0, userInputText)
              }

              const kMsg = {
                sender: "kkachil",
                text: kText,
                avatar: "😒",
                time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
              }

              setChatHistory([...h2, kMsg])
              setActiveAgent(null)
            }, 1500)
          }, 1000)

        }, 1500)
      }, 1000)

    }, 1500)
  }

  // 건강 상태 선택/토글
  const toggleState = (stateId) => {
    if (activeStates.includes(stateId)) {
      if (activeStates.length > 1) {
        setActiveStates(activeStates.filter(s => s !== stateId))
      }
    } else {
      setActiveStates([...activeStates, stateId])
    }
  }

  // 맛집 평점 직접 편집 (시뮬레이션 느낌 강화를 위해 제공)
  const incrementRating = (index) => {
    setPlaces(prev => {
      const next = [...prev]
      if (next[index]) {
        const nextRating = Math.min(5.0, Number((next[index].rating + 0.1).toFixed(1)))
        next[index] = { ...next[index], rating: nextRating }
      }
      return next
    })
  }

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon">🍛</div>
          <div className="logo-text">
            <h1>Bbb (비빔밥) 멀티 에이전트 융합 시뮬레이터</h1>
            <p>3인의 AI 패널이 벌이는 점심 메뉴 융합 오케스트레이션 엔진 v1.2 (SagoHub 연동)</p>
          </div>
        </div>

        {/* SagoHub 이벤트 버스 모듈 제어 패널 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '5px 12px', borderRadius: '10px', border: 'var(--glass-border)' }}>
            <Share2 size={14} style={{ color: hubConnected ? 'var(--color-kkachil)' : 'var(--color-beoreok)' }} />
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>SagoHub:</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: hubConnected ? 'var(--color-kkachil)' : 'var(--color-beoreok)' }}>
              {hubConnected ? "연결됨 (ACTIVE)" : "연결 안됨 (OFFLINE)"}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '5px 12px', borderRadius: '10px', border: 'var(--glass-border)' }}>
            <Cpu size={14} style={{ color: useHubLlm ? 'var(--color-sosim)' : 'var(--text-muted)' }} />
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>SagoHub LLM 모듈:</span>
            <input
              type="checkbox"
              checked={useHubLlm}
              disabled={!hubConnected}
              onChange={(e) => setUseHubLlm(e.target.checked)}
              style={{ cursor: 'pointer' }}
              title="SagoHub llm_prompt 모듈 사용"
            />
            {useHubLlm && hubConnected && llmModels.length > 0 ? (
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontSize: '0.75rem', fontWeight: 700, outline: 'none', cursor: 'pointer', maxWidth: '160px' }}
              >
                {llmModels.map(m => (
                  <option key={m.name} value={m.name} style={{ background: 'var(--bg-secondary)', color: 'var(--text-main)' }}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                {hubConnected ? '기본 모델 (gpt-4o-mini)' : 'Fallback'}
              </span>
            )}
          </div>

          <div className="engine-status">
            <div className={`status-dot ${isStreaming ? '' : activeAgent ? '' : 'idle'}`}></div>
            <span>
              {isStreaming ? "자율 토론 스트리밍 중" : activeAgent ? "개입 대응 연산 중" : "엔진 대기 중 (IDLE)"}
            </span>
          </div>
        </div>
      </header>

      {/* MAIN DASHBOARD */}
      <main className="main-dashboard">

        {/* LEFT PANEL (사용자 컨텍스트 입력) */}
        <section className="left-panel">
          <div className="panel-title">
            <Compass size={18} />
            <span>현재 컨텍스트 주입 (고명 필터)</span>
          </div>

          {/* 1. 위치 입력 */}
          <div className="form-group">
            <label>📍 위치 정보</label>
            <div className="select-wrapper">
              <select value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="강남역">강남역 (오피스 타운)</option>
                <option value="여의도">여의도 (금융 벨트)</option>
                <option value="홍대">홍대 (MZ/스트릿 패션)</option>
                <option value="custom">직접 위치 입력</option>
              </select>
            </div>
            {location === "custom" && (
              <div className="input-wrapper" style={{ marginTop: '8px' }}>
                <input
                  type="text"
                  placeholder="예: 판교 테크노밸리, 종로 3가"
                  value={customLocation}
                  onChange={(e) => setCustomLocation(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* 2. 날씨 입력 */}
          <div className="form-group">
            <label>☀️ 현재 날씨</label>
            <div className="weather-grid">
              {[
                { id: 'sunny', name: '화창함', icon: '☀️' },
                { id: 'rainy', name: '비 옴', icon: '🌧️' },
                { id: 'snowy', name: '눈 옴', icon: '❄️' },
                { id: 'cloudy', name: '우중충', icon: '☁️' },
                { id: 'hot', name: '폭염', icon: '🥵' },
                { id: 'windy', name: '강풍', icon: '💨' }
              ].map(w => (
                <button
                  key={w.id}
                  type="button"
                  className={`weather-btn ${weather === w.id ? 'active' : ''}`}
                  onClick={() => setWeather(w.id)}
                >
                  <span>{w.icon}</span>
                  <span>{w.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 3. 신체/건강 상태 */}
          <div className="form-group">
            <label>💪 신체 및 건강 상태</label>
            <div className="status-grid">
              {[
                { id: 'fatigued', name: '🥱 개피곤함' },
                { id: 'hungover', name: '🤮 숙취/해장' },
                { id: 'dieting', name: '🥗 다이어트' },
                { id: 'rich', name: '💵 지갑빵빵' },
                { id: 'energetic', name: '⚡ 고에너지' }
              ].map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`status-btn ${activeStates.includes(s.id) ? 'active' : ''}`}
                  onClick={() => toggleState(s.id)}
                >
                  <div className="status-checkbox"></div>
                  <span>{s.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 4. 인근 맛집 정보 리스트 */}
          <div className="form-group">
            <label>🍽️ 인근 실시간 맛집 레이더</label>
            <div className="places-board">
              {places.map((p, idx) => (
                <div key={idx} className="place-item">
                  <div className="place-info">
                    <span className="place-name">{p.name}</span>
                    <span className="place-meta">{p.desc} (웨이팅: {p.wait})</span>
                  </div>
                  <button
                    type="button"
                    className="place-rating"
                    onClick={() => incrementRating(idx)}
                    title="클릭 시 가상 리뷰 추천 점수 업"
                  >
                    ⭐ {p.rating}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 토론 트리거 버튼 */}
          <button
            type="button"
            className="action-btn"
            onClick={startDiscussion}
            disabled={isTyping}
          >
            <Flame size={20} />
            <span>비빔 토론 시작하기</span>
          </button>
        </section>

        {/* RIGHT PANEL (3인 에이전트 정보 및 대화 스트리밍) */}
        <section className="right-panel">

          {/* 상단 3인 패널 페르소나 리포트 */}
          <div className="agents-row">
            {/* 1. 버럭이 */}
            <div className={`agent-card beoreok ${activeAgent === 'beoreok' ? 'active' : ''} ${activeAgent === 'beoreok' && isTyping ? 'typing' : ''}`}>
              <div className="agent-avatar">😡</div>
              <div className="agent-meta">
                <div className="agent-name-badge">
                  <span className="agent-name">버럭이</span>
                  <span className="agent-persona-tag">도파민 킬러</span>
                </div>
                <span className="agent-trait">고에너지 닭가슴살 샐러드 맹신파</span>
              </div>
              <div className="agent-typing-dot">
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
              </div>
            </div>

            {/* 2. 소심이 */}
            <div className={`agent-card sosim ${activeAgent === 'sosim' ? 'active' : ''} ${activeAgent === 'sosim' && isTyping ? 'typing' : ''}`}>
              <div className="agent-avatar">🥺</div>
              <div className="agent-meta">
                <div className="agent-name-badge">
                  <span className="agent-name">소심이</span>
                  <span className="agent-persona-tag">감정 힐러</span>
                </div>
                <span className="agent-trait">소울푸드 따뜻한 국밥 국물 맹신파</span>
              </div>
              <div className="agent-typing-dot">
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
              </div>
            </div>

            {/* 3. 까칠이 */}
            <div className={`agent-card kkachil ${activeAgent === 'kkachil' ? 'active' : ''} ${activeAgent === 'kkachil' && isTyping ? 'typing' : ''}`}>
              <div className="agent-avatar">😒</div>
              <div className="agent-meta">
                <div className="agent-name-badge">
                  <span className="agent-name">까칠이</span>
                  <span className="agent-persona-tag">팩트 폭커</span>
                </div>
                <span className="agent-trait">가성비 최고 수제 돈까스 맹신파</span>
              </div>
              <div className="agent-typing-dot">
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
              </div>
            </div>
          </div>

          {/* 실시간 스트리밍 대화창 */}
          <div className="discussion-board">
            <div className="board-header">
              <h3>
                <MessageSquare size={16} />
                <span>에이전트 자율 점심 메뉴 논쟁 배틀</span>
              </h3>
              {chatHistory.length > 0 && (
                <button
                  type="button"
                  className="clear-logs-btn"
                  onClick={() => setChatHistory([])}
                >
                  <Trash2 size={12} />
                  <span>로그 비우기</span>
                </button>
              )}
            </div>

            <div className="discussion-stream">
              {chatHistory.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: '15px' }}>
                  <Sparkles size={40} style={{ color: 'var(--color-sosim)', opacity: 0.7 }} />
                  <p style={{ fontSize: '0.9rem', textAlign: 'center', lineHeight: 1.6 }}>
                    왼쪽 패널에 컨텍스트를 입력하고 <strong>[비빔 토론 시작하기]</strong>를 클릭하세요.<br />
                    3인 AI 에이전트가 자율적으로 메뉴 선택 대화를 시작합니다.
                  </p>
                </div>
              ) : (
                chatHistory.map((msg, index) => {
                  if (msg.sender === "system") {
                    return (
                      <div key={index} className={`chat-msg system ${msg.class || ''}`}>
                        <div className="system-bubble">
                          <span>{msg.avatar}</span>
                          <span>{msg.text}</span>
                        </div>
                      </div>
                    )
                  }

                  const isRight = msg.sender === "user"
                  return (
                    <div
                      key={index}
                      className={`chat-msg ${isRight ? 'right' : 'left'} ${msg.sender}`}
                    >
                      <div className="msg-avatar">{msg.avatar}</div>
                      <div className="msg-content-wrapper">
                        <span className="msg-sender">{msg.sender}</span>
                        <div className="msg-bubble">
                          {msg.text || (
                            <div style={{ display: 'flex', gap: '3px', padding: '4px 8px' }}>
                              <span className="typing-dot"></span>
                              <span className="typing-dot"></span>
                              <span className="typing-dot"></span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              {isTyping && (
                <div className={`chat-msg left ${activeAgent}`}>
                  <div className="msg-avatar">
                    {activeAgent === "beoreok" ? "😡" : activeAgent === "sosim" ? "🥺" : "😒"}
                  </div>
                  <div className="msg-content-wrapper">
                    <span className="msg-sender">{activeAgent}</span>
                    <div className="msg-bubble">
                      <div style={{ display: 'flex', gap: '4px', padding: '2px 6px' }}>
                        <span className="typing-dot"></span>
                        <span className="typing-dot"></span>
                        <span className="typing-dot"></span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={streamEndRef} />
            </div>

            {/* 하단 개입 및 채팅 컨트롤 */}
            <div className="chat-input-area">
              {/* 추천 칩 기능 */}
              <div className="recommend-chips">
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => setUserInput("오늘 진짜 엄청 비 내리는데?")}
                >
                  🌧️ 비 엄청 온다
                </button>
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => setUserInput("나 완전 빈털터리야... 돈 없어...")}
                >
                  💸 나 돈 없어
                </button>
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => setUserInput("아, 오늘 너무 일찍 일어나서 쓰러질 정도로 개피곤함")}
                >
                  🥱 대박 피곤함
                </button>
                <button
                  type="button"
                  className="chip-btn kick"
                  onClick={() => setUserInput("됐고! 오늘은 닭갈비!")}
                >
                  🔥 됐고! 오늘은 닭갈비!
                </button>
                <button
                  type="button"
                  className="chip-btn kick"
                  onClick={() => setUserInput("됐고! 오늘은 닭가슴살 샐러드!")}
                >
                  🥗 됐고! 오늘은 샐러드!
                </button>
              </div>

              {/* 입력 폼 */}
              <form onSubmit={handleSendMessage} className="chat-form">
                <div className="chat-input-wrapper">
                  <input
                    type="text"
                    className="chat-input"
                    placeholder="토론 중간에 의견을 던지거나 '됐고! 오늘은 [메뉴]!'를 외치세요..."
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                  />
                </div>
                <button type="submit" className="chat-submit-btn">
                  <Send size={18} />
                </button>
              </form>
            </div>

          </div>

        </section>

      </main>
    </div>
  )
}
