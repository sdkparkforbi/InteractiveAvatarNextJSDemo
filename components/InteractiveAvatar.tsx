/**
 * ================================================
 * InteractiveAvatar.tsx - 경영학전공 탭별 설명 아바타
 * ================================================
 *
 * 흐름:
 * 1. 메인 페이지(index.html)에서 탭 클릭
 * 2. postMessage로 TAB_CHANGED 수신
 * 3. TAB_SCRIPTS에서 해당 탭 스크립트 조회
 * 4. avatar.speak(REPEAT)로 미리 정의된 설명 발화
 *
 * ================================================
 */

import {
  AvatarQuality,
  StreamingEvents,
  VoiceEmotion,
  StartAvatarRequest,
  ElevenLabsModel,
  TaskType,
} from "@heygen/streaming-avatar";
import { useEffect, useRef, useState, useCallback } from "react";
import { useMemoizedFn, useUnmount } from "ahooks";

import { useStreamingAvatarSession } from "./logic/useStreamingAvatarSession";
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";
import { AVATARS } from "@/app/lib/constants";

// ============================================
// 🎯 탭별 설명 스크립트 (REPEAT 모드용)
// ============================================
const TAB_SCRIPTS: Record<string, string> = {
  tab1: `안녕하세요! 연구분야에 대해 설명드릴게요. 
우리 경영학전공은 경영기획, 마케팅, 회계재무 세 가지 핵심 분야를 다룹니다. 
경영기획에서는 ESG 평가지표 개발과 기업지배구조를, 
마케팅에서는 AI 서비스 로봇 수용도와 MZ세대 SNS 전략을, 
회계재무에서는 제약바이오 R&D 회계처리와 공시정보 신뢰성을 연구합니다.`,

  tab2: `통합교육이 왜 중요한지 설명드릴게요. 
기업 경영은 퍼즐과 같아서, 한 조각만으로는 전체 그림을 볼 수 없어요. 
재무 전문가도 마케팅 ROI를 분석해야 하고, 
회계사도 인건비 구조를 이해해야 합니다. 
실제 기업에서는 재무팀과 마케팅팀이 함께 일하거든요!`,

  tab3: `취업 전망에 대해 말씀드릴게요. 
우리 전공 취업률은 88.7%로 전국 평균 대비 우수합니다. 
경영기획 직무가 48.9%로 가장 많고, 
회계세무금융이 20.8%, 마케팅이 14%를 차지해요. 
경영학 단일전공만으로도 충분히 다양한 산업에 진출할 수 있습니다!`,

  tab4: `세부전공에 대해 설명드릴게요. 
경영기획은 기업 전략 수립과 ESG 경영을 다루고, 
마케팅은 소비자 행동 분석과 디지털 마케팅을, 
회계재무는 재무제표 분석과 리스크 관리를 배웁니다. 
특히 차의과학대만의 헬스케어 비즈니스와 비즈니스 애널리틱스 특화 분야가 있어요!`,

  tab5: `경영학의 미래가치에 대해 말씀드릴게요. 
AI 시대에도 경영학은 오히려 더 중요해집니다! 
AI와 빅데이터를 비즈니스로 전환하려면 경영 전문가가 필요하거든요. 
전략적 의사결정, 이해관계자 조정, 윤리적 경영 판단은 
AI가 대체할 수 없는 영역입니다.`,

  tab6: `팀프로젝트에 대해 설명드릴게요. 
네, 맞아요! 경영학과는 팀플과 발표가 많습니다. 
실제 기업이 팀워크 기반이기 때문이에요. 
팀플을 통해 의사소통 능력, 문제해결 능력, 리더십을 기를 수 있고, 
기업경영사례 경진대회 같은 실전 경험은 취업 시 큰 강점이 됩니다!`,

  tab7: `바이오융합에 대해 말씀드릴게요. 
바이오와 경영의 조합은 정말 강력합니다! 
바이오산업은 R&D 비용이 수천억 원에 달하고 제품 출시까지 10년 이상 걸려요. 
그래서 전략적 포트폴리오 관리와 파이낸싱이 필수입니다. 
실제로 졸업생의 24.9%가 바이오헬스케어 분야로 진출하고 있어요!`,

  tab8: `차의과학대만의 강점을 설명드릴게요. 
우리는 바이오헬스케어 특화 경영학입니다! 
차병원 네트워크와 연계되어 졸업생의 10.9%가 차병원그룹에 취업하고, 
의료경영, 바이오산업론 같은 특화 커리큘럼이 있어요. 
한국조세재정연구원, 금융감독원 등과의 연구 네트워크도 강점입니다.`,

  tab9: `졸업생 진로에 대해 말씀드릴게요. 
취업률 88.7%에 창업 5.4%, 대학원 진학 5.9%입니다. 
산업별로는 바이오헬스케어 24.9%, 금융 19.5%, IT 19%이고, 
하나은행, 삼성바이오로직스, 쿠팡, 세브란스병원 등 
다양한 분야의 기업에 취업하고 있어요!`,

  tab10: `예술경영에 대해 설명드릴게요. 
예술과 경영은 완벽한 조합입니다! 
공연기획자, 미술관 큐레이터, 문화마케터로 진출할 수 있어요. 
실제로 FNC엔터테인먼트, 서울환경영화제 등에 취업한 선배들이 있습니다. 
예술도 관객이 있어야 하고, 수익모델 설계가 필수니까요!`,

  tab11: `디지털보건의료와 AI의료데이터의 차이를 설명드릴게요. 
디지털보건의료는 서비스 기획 중심으로 사람과의 소통이 중요하고, 
병원 경영기획이나 디지털 헬스 서비스 기획 쪽으로 갑니다. 
AI의료데이터는 데이터 분석 중심으로 
헬스케어 데이터 분석가나 보험 리스크 분석 쪽으로 진출해요. 
둘 다 경영학과 시너지가 큽니다!`,

  tab12: `미디어융합에 대해 말씀드릴게요. 
미디어커뮤니케이션과 경영학은 완벽한 조합입니다! 
요즘 모든 기업이 미디어 기업이에요. 유튜브, 인스타 채널을 직접 운영하니까요. 
IR, PR, 콘텐츠 비즈니스, 인플루언서 마케팅 분야로 진출할 수 있고, 
광고대행사, 방송사, MCN 기업에 취업한 선배들이 많습니다!`,

  tab13: `수학이 걱정되시는 분들께 말씀드릴게요. 
걱정 마세요! 기초부터 차근차근 가르칩니다. 
회계원리는 자산 = 부채 + 자본부터, 
경영통계는 평균, 분산부터 시작해요. 
고등학교 수학 수준이면 충분하고, 
교수학습지원센터 튜터링과 선배 멘토링도 있습니다!`,

  tab14: `영상광고와 경영의 연결에 대해 설명드릴게요. 
영상 제작 능력에 경영 전략을 더하면 최강 콘텐츠 크리에이터가 됩니다! 
마케팅 프레임워크로 영상을 기획하고, 
A/B 테스트로 최적화하고, ROI를 측정할 수 있어요. 
단순히 예쁜 영상이 아니라, 목표를 달성하는 콘텐츠를 만들 수 있습니다!`,
};

// 아바타 설정
const DEFAULT_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: AVATARS[0].avatar_id,
  voice: {
    rate: 1.5,
    emotion: VoiceEmotion.EXCITED,
    model: ElevenLabsModel.eleven_flash_v2_5,
  },
  language: "ko",
};

function InteractiveAvatar() {
  const {
    initAvatar,
    startAvatar,
    stopAvatar,
    sessionState,
    stream,
    avatarRef,
  } = useStreamingAvatarSession();

  const [config] = useState<StartAvatarRequest>(DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState(false);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const [currentTab, setCurrentTab] = useState<string>("");
  const mediaStream = useRef<HTMLVideoElement>(null);
  const hasGreetedRef = useRef(false);

  // ============================================
  // API 호출
  // ============================================
  async function fetchAccessToken() {
    try {
      const response = await fetch("/api/get-access-token", {
        method: "POST",
      });
      const token = await response.text();
      console.log("Access Token:", token);
      return token;
    } catch (error) {
      console.error("Error fetching access token:", error);
      throw error;
    }
  }

  // ============================================
  // 아바타 음성 출력 (REPEAT 모드)
  // ============================================
  const speakWithAvatar = useCallback(
    async (text: string) => {
      if (!avatarRef.current || !text) return;

      try {
        setIsAvatarSpeaking(true);
        console.log("🗣️ Avatar speaking:", text);

        await avatarRef.current.speak({
          text: text,
          taskType: TaskType.REPEAT,
        });
      } catch (error) {
        console.error("Avatar speak error:", error);
        setIsAvatarSpeaking(false);
      }
    },
    [avatarRef]
  );

  // ============================================
  // 🎯 탭 변경 처리 (핵심 기능)
  // ============================================
  const handleTabChange = useCallback(
    async (tabId: string) => {
      console.log("📑 Tab changed:", tabId);
      setCurrentTab(tabId);

      const script = TAB_SCRIPTS[tabId];
      if (script && avatarRef.current) {
        // 현재 발화 중이면 중단
        try {
          await avatarRef.current.interrupt();
        } catch {
          // ignore
        }

        await speakWithAvatar(script);
      } else {
        console.warn("⚠️ No script found for tab:", tabId);
      }
    },
    [avatarRef, speakWithAvatar]
  );

  // ============================================
  // 세션 시작
  // ============================================
  const startSession = useMemoizedFn(async () => {
    try {
      const newToken = await fetchAccessToken();
      const avatarInstance = initAvatar(newToken);

      avatarInstance.on(StreamingEvents.STREAM_READY, async (event) => {
        console.log(">>>>> Stream ready:", event.detail);

        // 첫 인사
        if (!hasGreetedRef.current) {
          await new Promise((r) => setTimeout(r, 1500));

          const greeting =
            "안녕하세요! 차의과학대학교 경영학전공 AI 가이드입니다. 궁금한 탭을 클릭하시면 자세히 설명해드릴게요!";

          await speakWithAvatar(greeting);
          hasGreetedRef.current = true;
        }
      });

      avatarInstance.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("Stream disconnected");
        hasGreetedRef.current = false;
      });

      avatarInstance.on(StreamingEvents.AVATAR_START_TALKING, () => {
        console.log("🗣️ Avatar started talking");
        setIsAvatarSpeaking(true);
      });

      avatarInstance.on(StreamingEvents.AVATAR_STOP_TALKING, () => {
        console.log("🔈 Avatar stopped talking");
        setIsAvatarSpeaking(false);
      });

      await startAvatar(config);
    } catch (error) {
      console.error("Error starting avatar session:", error);
    }
  });

  // ============================================
  // 🎯 postMessage 통신 (메인 페이지와)
  // ============================================
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // origin 검증 (보안)
      const allowedOrigins = [
        "https://sdkparkforbi.github.io",
        "http://localhost",
        "http://127.0.0.1",
      ];

      const isAllowed = allowedOrigins.some((origin) =>
        event.origin.startsWith(origin)
      );

      if (!isAllowed) {
        console.log("⚠️ Ignored message from:", event.origin);
        return;
      }

      const { type, tabId } = event.data || {};
      console.log("📥 Received message:", { type, tabId, origin: event.origin });

      if (type === "TAB_CHANGED" && tabId) {
        handleTabChange(tabId);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleTabChange]);

  // 언마운트 시 정리
  useUnmount(() => {
    stopAvatar();
  });

  // 비디오 스트림 연결
  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current!.play();
      };
    }
  }, [mediaStream, stream]);

  // ============================================
  // UI
  // ============================================
  const getStatusText = () => {
    if (isAvatarSpeaking) return "설명 중...";
    if (isLoading) return "준비 중...";
    return "탭을 클릭하세요";
  };

  const getStatusColor = () => {
    if (isAvatarSpeaking) return "bg-blue-500 animate-pulse";
    if (isLoading) return "bg-yellow-500";
    return "bg-green-500";
  };

  return (
    <div className="w-full h-full flex flex-col">
      {sessionState === StreamingAvatarSessionState.CONNECTED && stream ? (
        <div className="flex-1 relative flex flex-col">
          <div className="relative flex-shrink-0">
            <video
              ref={mediaStream}
              autoPlay
              playsInline
              style={{ display: "block", width: "100%", height: "auto" }}
            />

            {/* 종료 버튼 */}
            <button
              className="absolute top-2 right-2 w-7 h-7 bg-black/50 hover:bg-red-600 text-white rounded-full flex items-center justify-center text-xs transition-all"
              title="종료"
              onClick={() => stopAvatar()}
            >
              ✕
            </button>

            {/* 상태 표시 */}
            <div className="absolute bottom-2 left-2 flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
              <span className="text-white text-xs bg-black/50 px-2 py-1 rounded">
                {getStatusText()}
              </span>
            </div>

            {/* 현재 탭 표시 */}
            {currentTab && (
              <div className="absolute top-2 left-2">
                <span className="text-white text-xs bg-purple-600/80 px-2 py-1 rounded">
                  📑 {currentTab}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          {sessionState === StreamingAvatarSessionState.CONNECTING ? (
            <div className="flex flex-col items-center gap-3 text-white">
              <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">연결 중...</span>
            </div>
          ) : (
            <button
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-full text-base font-medium transition-all shadow-lg hover:shadow-xl"
              onClick={startSession}
            >
              🎓 AI 가이드 시작
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function InteractiveAvatarWrapper() {
  return (
    <StreamingAvatarProvider basePath={process.env.NEXT_PUBLIC_BASE_API_URL}>
      <InteractiveAvatar />
    </StreamingAvatarProvider>
  );
}
