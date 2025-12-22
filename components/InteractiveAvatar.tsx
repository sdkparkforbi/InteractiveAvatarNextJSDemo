import {
  AvatarQuality,
  StreamingEvents,
  VoiceChatTransport,
  VoiceEmotion,
  StartAvatarRequest,
  STTProvider,
  ElevenLabsModel,
} from "@heygen/streaming-avatar";
import { useEffect, useRef, useState } from "react";
import { useMemoizedFn, useUnmount } from "ahooks";

import { Button } from "./Button";
import { AvatarConfig } from "./AvatarConfig";
import { AvatarVideo } from "./AvatarSession/AvatarVideo";
import { useStreamingAvatarSession } from "./logic/useStreamingAvatarSession";
import { AvatarControls } from "./AvatarSession/AvatarControls";
import { useVoiceChat } from "./logic/useVoiceChat";
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";
import { LoadingIcon } from "./Icons";
import { MessageHistory } from "./AvatarSession/MessageHistory";

import { AVATARS } from "@/app/lib/constants";

// ============================================
// 🎯 경영학전공 상담 AI 프롬프트
// ============================================
const KNOWLEDGE_BASE_PROMPT = `당신은 차의과학대학교 경영학전공 상담 AI 도우미입니다.

## 역할
- 경영학전공 교육과정 및 커리큘럼 안내
- 취업 및 진로 상담
- 입학 및 전공 관련 문의 응답
- 학과 생활 및 학사 정보 제공

## 지식베이스
### 전공 교과목
- 전공필수: 경영학원론, 회계원리, 마케팅원론, 재무관리, 인적자원관리
- 전공선택: 경영정보시스템, 국제경영, 창업론, 디지털마케팅, 빅데이터경영

### 졸업요건
- 총 130학점 이수
- 전공 45학점 이상 (전공필수 + 전공선택)
- 복수전공/부전공 가능

### 진로 및 취업
- 대기업 경영관리, 마케팅, 인사부서
- 금융권 (은행, 증권, 보험)
- 컨설팅 및 회계법인
- 스타트업 창업
- 대학원 진학

## 대화 규칙
1. 항상 친절하고 전문적인 어조로 응답하세요
2. 한국어로 답변하세요
3. 간결하고 명확하게 핵심만 전달하세요
4. 모르는 내용은 "학과 사무실(031-xxx-xxxx)로 문의해주세요"라고 안내하세요
5. 첫 인사로 "안녕하세요! 차의과학대학교 경영학전공 상담 도우미입니다. 무엇을 도와드릴까요?"라고 하세요`;

// ============================================
// 🔧 기본 설정 (자동 시작용)
// ============================================
const DEFAULT_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Medium,  // 화질 향상
  avatarName: AVATARS[0].avatar_id,
  knowledgeBase: KNOWLEDGE_BASE_PROMPT,  // ⭐ 프롬프트 추가
  voice: {
    rate: 1.0,  // 말하기 속도 (1.0 = 보통)
    emotion: VoiceEmotion.FRIENDLY,  // 친근한 감정
    model: ElevenLabsModel.eleven_flash_v2_5,
  },
  language: "ko",  // ⭐ 한국어로 변경
  voiceChatTransport: VoiceChatTransport.WEBSOCKET,
  sttSettings: {
    provider: STTProvider.DEEPGRAM,
  },
};

function InteractiveAvatar() {
  const { initAvatar, startAvatar, stopAvatar, sessionState, stream } =
    useStreamingAvatarSession();
  const { startVoiceChat } = useVoiceChat();

  const [config, setConfig] = useState<StartAvatarRequest>(DEFAULT_CONFIG);
  const [isAutoStarted, setIsAutoStarted] = useState(false);  // 자동 시작 여부 추적

  const mediaStream = useRef<HTMLVideoElement>(null);

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

  const startSessionV2 = useMemoizedFn(async (isVoiceChat: boolean) => {
    try {
      const newToken = await fetchAccessToken();
      const avatar = initAvatar(newToken);

      avatar.on(StreamingEvents.AVATAR_START_TALKING, (e) => {
        console.log("Avatar started talking", e);
      });
      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, (e) => {
        console.log("Avatar stopped talking", e);
      });
      avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("Stream disconnected");
      });
      avatar.on(StreamingEvents.STREAM_READY, (event) => {
        console.log(">>>>> Stream ready:", event.detail);
      });
      avatar.on(StreamingEvents.USER_START, (event) => {
        console.log(">>>>> User started talking:", event);
      });
      avatar.on(StreamingEvents.USER_STOP, (event) => {
        console.log(">>>>> User stopped talking:", event);
      });
      avatar.on(StreamingEvents.USER_END_MESSAGE, (event) => {
        console.log(">>>>> User end message:", event);
      });
      avatar.on(StreamingEvents.USER_TALKING_MESSAGE, (event) => {
        console.log(">>>>> User talking message:", event);
      });
      avatar.on(StreamingEvents.AVATAR_TALKING_MESSAGE, (event) => {
        console.log(">>>>> Avatar talking message:", event);
      });
      avatar.on(StreamingEvents.AVATAR_END_MESSAGE, (event) => {
        console.log(">>>>> Avatar end message:", event);
      });

      await startAvatar(config);

      if (isVoiceChat) {
        await startVoiceChat();
      }
    } catch (error) {
      console.error("Error starting avatar session:", error);
    }
  });

  // ============================================
  // ⭐ 자동 시작: 페이지 로드 시 바로 음성 채팅 시작
  // ============================================
  useEffect(() => {
    if (!isAutoStarted && sessionState === StreamingAvatarSessionState.INACTIVE) {
      setIsAutoStarted(true);
      // 1초 딜레이 후 자동 시작 (페이지 완전 로드 대기)
      const timer = setTimeout(() => {
        startSessionV2(true);  // true = Voice Chat 모드
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isAutoStarted, sessionState, startSessionV2]);

  useUnmount(() => {
    stopAvatar();
  });

  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current!.play();
      };
    }
  }, [mediaStream, stream]);

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex flex-col rounded-xl bg-zinc-900 overflow-hidden">
        <div className="relative w-full aspect-video overflow-hidden flex flex-col items-center justify-center">
          {sessionState !== StreamingAvatarSessionState.INACTIVE ? (
            <AvatarVideo ref={mediaStream} />
          ) : (
            // 자동 시작 중일 때 로딩 표시
            <div className="flex flex-col items-center justify-center gap-4 text-white">
              <LoadingIcon />
              <p>상담 도우미를 불러오는 중...</p>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 items-center justify-center p-4 border-t border-zinc-700 w-full">
          {sessionState === StreamingAvatarSessionState.CONNECTED ? (
            <AvatarControls />
          ) : sessionState === StreamingAvatarSessionState.INACTIVE ? (
            // 자동 시작 실패 시 수동 버튼 표시
            <div className="flex flex-row gap-4">
              <Button onClick={() => startSessionV2(true)}>
                음성 상담 시작
              </Button>
              <Button onClick={() => startSessionV2(false)}>
                텍스트 상담 시작
              </Button>
            </div>
          ) : (
            <LoadingIcon />
          )}
        </div>
      </div>
      {sessionState === StreamingAvatarSessionState.CONNECTED && (
        <MessageHistory />
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
