/**
 * ================================================
 * InteractiveAvatar.tsx - 치매예방 게임 AI 아바타
 * ================================================
 *
 * 🆕 2026-01-22 업데이트: 음성 명령 기반 게임 제어
 * 🔧 2026-01-22 수정: 의도 분석 로직 개선
 *    - "실행", "열어", "켜줘" 등 키워드 추가
 *    - UI_CONTROL 먼저 체크하도록 순서 변경
 *    - confidence threshold 조정
 * 
 * 기능:
 * 1. 음성 명령 → Intent Recognition → 게임/UI 자동 제어
 * 2. 일반 대화 → OpenAI → 응답 생성
 * 3. postMessage로 index.html과 양방향 통신
 *
 * 핵심: 아바타가 말할 때 Web Speech 일시정지 → 자기 목소리 인식 방지
 * ================================================
 */

import {
  AvatarQuality,
  StreamingEvents,
  VoiceEmotion,
  StartAvatarRequest,
  TaskType,
} from "@heygen/streaming-avatar";
import { useEffect, useRef, useState, useCallback } from "react";
import { useMemoizedFn, useUnmount } from "ahooks";

import { useStreamingAvatarSession } from "./logic/useStreamingAvatarSession";
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";
import { AVATARS } from "@/app/lib/constants";
import { WebSpeechRecognizer } from "@/app/lib/webSpeechAPI";

// ============================================
// 🆕 음성 명령 의도 분석 시스템 (수정됨)
// ============================================

interface VoiceIntent {
  type: 'GAME_START' | 'UI_CONTROL' | 'INFO_REQUEST' | 'GENERAL_CHAT';
  action?: string;
  game?: string;
  confidence: number;
}

// 명령어 패턴 정의 (한국어 자연어 변형 포함)
const VOICE_COMMAND_PATTERNS = {
  // 게임 시작 명령
  GAME_START: {
    hwatu: [
      '화투', '카드', '짝맞추기', '짝 맞추기', '카드게임', '카드 게임',
      '화투 시작', '카드 시작', '짝맞추기 시작', '짝맞추기 해', '짝맞추기 하자',
      '화투 게임', '카드짝', '그림 맞추기'
    ],
    pattern: [
      '색상', '패턴', '색깔', '색상 패턴', '색깔 기억', '색상 게임', '패턴 게임',
      '색상 시작', '패턴 시작', '색깔 맞추기', '사이먼', '색깔 순서'
    ],
    memory: [
      '숫자', '숫자 기억', '숫자 외우기', '숫자 게임', '숫자 맞추기',
      '숫자 시작', '숫자 기억하기', '숫자 외우기 하자', '번호 기억'
    ],
    proverb: [
      '속담', '속담 완성', '속담 게임', '속담 맞추기', '속담 시작',
      '속담 완성하기', '속담 하자', '옛말', '격언'
    ],
    calc: [
      '계산', '산수', '덧셈', '뺄셈', '계산 게임', '산수 게임',
      '계산 시작', '산수 시작', '계산 하자', '산수 하자', '수학', '더하기 빼기',
      '산수 계산'  // 🆕 추가
    ],
    sequence: [
      '순서', '순서 맞추기', '그림 순서', '순서 게임', '순서 시작',
      '순서 맞추기 하자', '순서 정하기', '차례', '배열'
    ]
  },
  
  // UI 제어 명령
  UI_CONTROL: {
    SHOW_MY_RECORDS: [
      '내 점수', '내 기록', '점수 보여', '기록 보여', '내 점수 보여줘',
      '점수 확인', '내 성적', '성적 보여줘', '내 기록 보여줘', '점수 창'
    ],
    SHOW_DASHBOARD: [
      '대시보드', '인지 분석', '두뇌 건강', '분석 보여줘', '인지 점수',
      '두뇌 분석', '건강 분석', '인지 능력', '뇌 건강'
    ],
    SHOW_RANKING: [
      '랭킹', '순위', '1등', '일등', '랭킹 보여줘', '순위 보여줘',
      '누가 1등', '전체 순위', '랭킹 창', '등수'
    ],
    CLOSE_MODAL: [
      '닫아', '닫기', '나가', '나가기', '뒤로', '뒤로가기', '창 닫아',
      '그만', '끝', '종료', '취소', '돌아가'
    ],
    SAVE_SCORE: [
      '저장', '저장해', '저장해줘', '기록 저장', '점수 저장',
      '세이브', '저장하자', '저장 해줘'
    ]
  },
  
  // 정보 요청 (기존 LLM 처리) - action 키워드 감지용
  INFO_REQUEST: [
    '점수 알려줘', '오늘 몇점', '최고 점수', '평균 점수',
    '몇번 했어', '며칠째', '설명해줘', '어떻게 해', '방법 알려줘',
    '규칙이 뭐야', '어떻게 하는 거야'
  ]
};

// 🆕 게임 시작 동작 키워드 (확장됨!)
const GAME_ACTION_KEYWORDS = [
  '시작', '하자', '해줘', '해', '할래', '하고 싶어', '해볼래', '하고싶어',
  '실행', '열어', '켜줘', '켜', '플레이', '게임', '고', 'go', '해보자',
  '열어줘', '시작해', '시작해줘', '해봐', '해 봐', '시작하자'
];

// 게임 한글명 매핑
const GAME_NAMES: Record<string, string> = {
  hwatu: '화투 짝맞추기',
  pattern: '색상 패턴 기억',
  memory: '숫자 기억하기',
  proverb: '속담 완성하기',
  calc: '산수 계산',
  sequence: '순서 맞추기'
};

// UI 액션별 응답 메시지
const UI_RESPONSES: Record<string, string> = {
  'SHOW_MY_RECORDS': '네, 기록을 보여드릴게요.',
  'SHOW_DASHBOARD': '인지 분석 대시보드를 열어드릴게요.',
  'SHOW_RANKING': '전체 랭킹을 보여드릴게요.',
  'CLOSE_MODAL': '네, 창을 닫을게요.',
  'SAVE_SCORE': '점수를 저장할게요.'
};

/**
 * 🆕 음성 입력에서 의도를 분석하는 함수 (수정됨!)
 * 
 * 순서: UI_CONTROL → GAME_START → INFO_REQUEST → GENERAL_CHAT
 * (UI 제어를 먼저 체크하여 "랭킹"이 게임 시작으로 오인되지 않도록)
 */
function analyzeVoiceIntent(transcript: string): VoiceIntent {
  const normalizedText = transcript
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  
  console.log('[🔍 Intent Analysis] Input:', normalizedText);
  
  // ⭐ 1. UI 제어 명령 먼저 체크 (우선순위 높음!)
  for (const [action, keywords] of Object.entries(VOICE_COMMAND_PATTERNS.UI_CONTROL)) {
    for (const keyword of keywords) {
      if (normalizedText.includes(keyword)) {
        console.log('[🔍 Intent Analysis] UI_CONTROL matched:', action, 'keyword:', keyword);
        return {
          type: 'UI_CONTROL',
          action: action,
          confidence: 0.95
        };
      }
    }
  }
  
  // 2. 게임 시작 명령 체크
  for (const [game, keywords] of Object.entries(VOICE_COMMAND_PATTERNS.GAME_START)) {
    for (const keyword of keywords) {
      if (normalizedText.includes(keyword)) {
        // 🆕 확장된 동작 키워드 체크
        const hasActionWord = GAME_ACTION_KEYWORDS.some(action => normalizedText.includes(action));
        
        // 게임 이름만 말해도 시작 의도로 인식 (어르신 편의성)
        // 단, 너무 짧은 단어(예: "숫자", "계산")는 동작 키워드 필요
        const isShortKeyword = keyword.length <= 2;
        
        // 🆕 게임 관련 키워드가 명확하면 바로 인식
        const isExplicitGameKeyword = keyword.includes('게임') || keyword.includes('시작');
        
        if (hasActionWord || isExplicitGameKeyword || (!isShortKeyword && keywords.slice(0, 3).some(k => normalizedText.includes(k)))) {
          console.log('[🔍 Intent Analysis] GAME_START matched:', game, 'keyword:', keyword, 'hasAction:', hasActionWord);
          return {
            type: 'GAME_START',
            action: `START_GAME_${game.toUpperCase()}`,
            game: game,
            confidence: hasActionWord ? 0.95 : 0.85
          };
        }
      }
    }
  }
  
  // 3. 정보 요청 체크 (기존 LLM으로 처리)
  for (const keyword of VOICE_COMMAND_PATTERNS.INFO_REQUEST) {
    if (normalizedText.includes(keyword)) {
      console.log('[🔍 Intent Analysis] INFO_REQUEST matched:', keyword);
      return {
        type: 'INFO_REQUEST',
        confidence: 0.85
      };
    }
  }
  
  // 4. 일반 대화
  console.log('[🔍 Intent Analysis] GENERAL_CHAT (default)');
  return {
    type: 'GENERAL_CHAT',
    confidence: 0.7
  };
}

// ============================================
// 아바타 설정
// ============================================
const AVATAR_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: AVATARS[0].avatar_id,
  voice: {
    rate: 1.2,
    emotion: VoiceEmotion.FRIENDLY,
  },
  language: "ko",
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function InteractiveAvatar() {
  const {
    initAvatar,
    startAvatar,
    stopAvatar,
    sessionState,
    stream,
    avatarRef,
  } = useStreamingAvatarSession();

  // UI 상태
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const mediaStream = useRef<HTMLVideoElement>(null);

  // 내부 상태 refs
  const isProcessingRef = useRef(false);
  const hasGreetedRef = useRef(false);
  const hasStartedRef = useRef(false);
  const userNameRef = useRef<string>("");
  const userStatsRef = useRef<any>(null);

  // Web Speech API ref
  const webSpeechRef = useRef<WebSpeechRecognizer | null>(null);
  const isAvatarSpeakingRef = useRef(false);

  // ============================================
  // API 호출
  // ============================================
  const fetchAccessToken = async () => {
    const response = await fetch("/api/get-access-token", { method: "POST" });
    const token = await response.text();
    console.log("Access Token:", token);
    return token;
  };

  // 🎯 LLM API 호출 (채팅, 인사말, 게임설명)
  const callChatAPI = async (
    type: string,
    data: Record<string, any>
  ): Promise<string> => {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          ...data,
          userName: userNameRef.current,
        }),
      });
      const result = await response.json();
      return result.reply || "응답을 생성할 수 없습니다.";
    } catch (error) {
      console.error("Chat API error:", error);
      return "죄송합니다. 오류가 발생했습니다.";
    }
  };

  // ============================================
  // 🆕 부모 창(index.html)에 음성 명령 전송
  // ============================================
  const sendVoiceCommand = useCallback((action: string, game?: string) => {
    console.log("📤 Sending VOICE_COMMAND:", { action, game });
    window.parent.postMessage({
      type: 'VOICE_COMMAND',
      action: action,
      game: game,
      timestamp: Date.now()
    }, '*');
  }, []);

  // ============================================
  // 아바타 음성 출력 (Web Speech 일시정지 포함)
  // ============================================
  const speakWithAvatar = useCallback(
    async (text: string) => {
      if (!avatarRef.current || !text) return;

      try {
        // 🔇 Web Speech 완전히 정지
        console.log("🔇 Web Speech 일시정지");
        isAvatarSpeakingRef.current = true;
        setIsAvatarSpeaking(true);
        webSpeechRef.current?.pause();

        // 잠시 대기 (Web Speech가 완전히 멈출 때까지)
        await new Promise((r) => setTimeout(r, 300));

        // HeyGen 자동 응답 차단
        try {
          await avatarRef.current.interrupt();
        } catch {
          // ignore
        }

        console.log("🗣️ Avatar speaking:", text);
        await avatarRef.current.speak({
          text,
          taskType: TaskType.REPEAT,
        });
      } catch (error) {
        console.error("Avatar speak error:", error);
        isAvatarSpeakingRef.current = false;
        setIsAvatarSpeaking(false);
        webSpeechRef.current?.resume();
      }
    },
    [avatarRef]
  );

  // ============================================
  // 🆕 사용자 음성 처리 (Intent Recognition 포함) - 수정됨!
  // ============================================
  const handleUserSpeech = useCallback(
    async (transcript: string) => {
      // 아바타가 말하는 중이면 무시
      if (isAvatarSpeakingRef.current) {
        console.log("⏸️ 아바타가 말하는 중 - 무시:", transcript);
        return;
      }

      if (!transcript.trim() || isProcessingRef.current) return;

      isProcessingRef.current = true;
      setIsLoading(true);
      setInterimTranscript("");
      console.log("🎯 User said:", transcript);

      try {
        // 🆕 의도 분석
        const intent = analyzeVoiceIntent(transcript);
        console.log('[Voice Intent Result]', intent);

        switch (intent.type) {
          case 'GAME_START':
            // 🆕 먼저 부모 창에 게임 시작 명령 전송!
            sendVoiceCommand(intent.action!, intent.game);
            
            // 그 다음 아바타가 응답
            const gameName = GAME_NAMES[intent.game!] || intent.game;
            const gameResponse = `네! ${gameName} 게임을 시작할게요. 화이팅!`;
            
            setChatHistory(prev => [
              ...prev,
              { role: "user", content: transcript },
              { role: "assistant", content: gameResponse }
            ]);
            
            await speakWithAvatar(gameResponse);
            break;

          case 'UI_CONTROL':
            // 부모 창에 UI 제어 명령 전송
            sendVoiceCommand(intent.action!);
            
            // 아바타 응답
            const uiResponse = UI_RESPONSES[intent.action!] || '알겠습니다.';
            
            setChatHistory(prev => [
              ...prev,
              { role: "user", content: transcript },
              { role: "assistant", content: uiResponse }
            ]);
            
            await speakWithAvatar(uiResponse);
            break;

          case 'INFO_REQUEST':
          case 'GENERAL_CHAT':
          default:
            // 기존 LLM 대화 처리
            setChatHistory(prev => [
              ...prev,
              { role: "user", content: transcript }
            ]);

            const reply = await callChatAPI('chat', {
              message: transcript,
              history: chatHistory
            });
            
            setChatHistory(prev => [
              ...prev,
              { role: "assistant", content: reply }
            ]);
            
            await speakWithAvatar(reply);
            break;
        }
      } catch (error) {
        console.error('[Voice Command Error]', error);
        await speakWithAvatar('죄송해요, 다시 한번 말씀해 주세요.');
      } finally {
        setIsLoading(false);
        isProcessingRef.current = false;
      }
    },
    [speakWithAvatar, sendVoiceCommand, chatHistory]
  );

  // ============================================
  // Web Speech API 초기화
  // ============================================
  const initWebSpeech = useCallback(() => {
    if (webSpeechRef.current) {
      console.log("🎤 Web Speech 이미 초기화됨");
      return;
    }

    if (!WebSpeechRecognizer.isSupported()) {
      console.error("🎤 Web Speech API 지원하지 않는 브라우저");
      return;
    }

    console.log("🎤 Web Speech API 초기화 중...");

    webSpeechRef.current = new WebSpeechRecognizer(
      {
        onResult: (transcript: string, isFinal: boolean) => {
          if (isAvatarSpeakingRef.current) {
            return;
          }

          if (isFinal) {
            console.log("🎤 최종 인식:", transcript);
            setInterimTranscript("");
            handleUserSpeech(transcript);
          } else {
            setInterimTranscript(transcript);
          }
        },

        onStart: () => {
          if (!isAvatarSpeakingRef.current) {
            setIsListening(true);
          }
        },

        onEnd: () => {
          setIsListening(false);
        },

        onSpeechStart: () => {
          if (!isAvatarSpeakingRef.current) {
            setIsListening(true);
          }
        },

        onSpeechEnd: () => {
          setTimeout(() => {
            if (!isAvatarSpeakingRef.current) {
              setIsListening(false);
            }
          }, 500);
        },

        onError: (error: string) => {
          console.error("🎤 Web Speech 에러:", error);
          if (error === "not-allowed") {
            alert("마이크 권한이 필요합니다. 브라우저 설정에서 마이크를 허용해주세요.");
          }
        },
      },
      {
        lang: "ko-KR",
        continuous: true,
        interimResults: true,
        autoRestart: true,
      }
    );

    console.log("🎤 Web Speech API 초기화 완료");
  }, [handleUserSpeech]);

  // ============================================
  // 세션 초기화
  // ============================================
  const resetSession = useMemoizedFn(async () => {
    console.log("🔄 세션 초기화 중...");

    // Web Speech 정리
    if (webSpeechRef.current) {
      webSpeechRef.current.destroy();
      webSpeechRef.current = null;
    }

    // HeyGen 세션 정리
    try {
      if (avatarRef.current) {
        await avatarRef.current.stopAvatar();
      }
    } catch (e) {
      console.log("stopAvatar 에러 (무시):", e);
    }

    try {
      await stopAvatar();
    } catch (e) {
      console.log("stopAvatar hook 에러 (무시):", e);
    }

    // 상태 초기화
    hasStartedRef.current = false;
    hasGreetedRef.current = false;
    isProcessingRef.current = false;
    isAvatarSpeakingRef.current = false;
    userNameRef.current = "";
    userStatsRef.current = null;
    setChatHistory([]);
    setIsLoading(false);
    setIsListening(false);
    setIsAvatarSpeaking(false);
    setInterimTranscript("");

    await new Promise((r) => setTimeout(r, 1000));
    console.log("🔄 세션 초기화 완료");
  });

  // ============================================
  // 세션 시작
  // ============================================
  const startSession = useMemoizedFn(async () => {
    if (hasStartedRef.current) {
      console.log("⚠️ 이미 세션 시작됨, 무시");
      return;
    }
    hasStartedRef.current = true;

    try {
      const token = await fetchAccessToken();
      const avatar = initAvatar(token);

      avatar.on(StreamingEvents.STREAM_READY, async (event) => {
        console.log("Stream ready:", event.detail);

        if (!hasGreetedRef.current) {
          await new Promise((r) => setTimeout(r, 1500));

          // 인사말 생성
          const userName = userNameRef.current;
          let greeting: string;
          
          if (userName) {
            greeting = await callChatAPI('greeting', { userName });
          } else {
            greeting = "안녕하세요! 저는 두뇌 건강 도우미예요. '산수 계산 게임 실행'이나 '내 점수 보여줘'처럼 말씀해 주세요!";
          }

          console.log("👋 인사말:", greeting);
          await speakWithAvatar(greeting);
          setChatHistory([{ role: "assistant", content: greeting }]);
          hasGreetedRef.current = true;
        }
      });

      avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("Stream disconnected");
        hasGreetedRef.current = false;
        hasStartedRef.current = false;

        webSpeechRef.current?.destroy();
        webSpeechRef.current = null;
      });

      avatar.on(StreamingEvents.AVATAR_START_TALKING, () => {
        console.log("🗣️ Avatar started talking - Web Speech 일시정지");
        isAvatarSpeakingRef.current = true;
        setIsAvatarSpeaking(true);
        webSpeechRef.current?.pause();
      });

      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, async () => {
        console.log("🔈 Avatar stopped talking - Web Speech 재개");
        isAvatarSpeakingRef.current = false;
        setIsAvatarSpeaking(false);

        await new Promise((r) => setTimeout(r, 500));
        webSpeechRef.current?.resume();
        console.log("🎤 Web Speech 재개 완료");
      });

      await startAvatar(AVATAR_CONFIG);

      console.log("🎤 Web Speech API 시작...");
      initWebSpeech();

      setTimeout(() => {
        webSpeechRef.current?.start();
        console.log("🎤 Web Speech 인식 시작");
      }, 2000);
    } catch (error) {
      console.error("Session error:", error);
      hasStartedRef.current = false;
    }
  });

  // ============================================
  // 텍스트 메시지 전송
  // ============================================
  const handleSendMessage = useMemoizedFn(async () => {
    const text = inputText.trim();
    if (!text || !avatarRef.current || isLoading) return;

    setInputText("");
    
    // 텍스트 입력도 음성과 동일하게 처리
    await handleUserSpeech(text);
  });

  // ============================================
  // 마이크 토글 버튼 핸들러
  // ============================================
  const toggleMicrophone = useCallback(() => {
    if (!webSpeechRef.current) {
      initWebSpeech();
      setTimeout(() => {
        webSpeechRef.current?.start();
      }, 100);
      return;
    }

    if (webSpeechRef.current.getIsPaused()) {
      webSpeechRef.current.resume();
    } else {
      webSpeechRef.current.pause();
    }
  }, [initWebSpeech]);

  // ============================================
  // postMessage 통신 (메인 페이지와)
  // ============================================
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const { type, name, stats, game } = event.data || {};
      console.log("📥 Received message:", { type, name, game });

      switch (type) {
        case "RESET_AVATAR":
        case "STOP_AVATAR":
          await resetSession();
          break;

        case "START_AVATAR":
          await resetSession();
          if (name) userNameRef.current = name;
          if (stats) userStatsRef.current = stats;
          startSession();
          break;

        case "EXPLAIN_GAME":
          if (avatarRef.current && game) {
            const explanation = await callChatAPI("game_explain", { game });
            await speakWithAvatar(explanation);
          }
          break;

        case "EXPLAIN_DASHBOARD":
          if (avatarRef.current) {
            const explanation = await callChatAPI("dashboard_explain", event.data);
            await speakWithAvatar(explanation);
          }
          break;
          
        case "USER_INFO":
          if (name) userNameRef.current = name;
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [resetSession, startSession, speakWithAvatar]);

  // 언마운트 시 정리
  useUnmount(() => {
    webSpeechRef.current?.destroy();
    try {
      stopAvatar();
    } catch {
      // ignore
    }
  });

  // 페이지 새로고침/닫기 전 세션 정리
  useEffect(() => {
    const handleBeforeUnload = () => {
      console.log("🔄 beforeunload - 세션 정리 중...");
      if (webSpeechRef.current) {
        webSpeechRef.current.destroy();
        webSpeechRef.current = null;
      }
      if (avatarRef.current) {
        try {
          avatarRef.current.stopAvatar();
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [avatarRef]);

  // 비디오 스트림 연결
  useEffect(() => {
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => mediaStream.current?.play();
    }
  }, [stream]);

  // ============================================
  // UI
  // ============================================
  const getStatusText = () => {
    if (isAvatarSpeaking) return "말하는 중...";
    if (isListening) return "듣고 있어요 🎤";
    if (isLoading) return "생각 중...";
    return "말씀하세요";
  };

  const getStatusColor = () => {
    if (isAvatarSpeaking) return "bg-blue-500";
    if (isListening) return "bg-red-500 animate-pulse";
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
              className="absolute top-2 right-2 w-7 h-7 bg-black/50 hover:bg-red-600 text-white rounded-full flex items-center justify-center text-xs"
              onClick={() => resetSession()}
            >
              ✕
            </button>

            {/* 마이크 토글 버튼 */}
            <button
              className={`absolute top-2 left-2 w-7 h-7 ${
                isListening
                  ? "bg-red-500 animate-pulse"
                  : "bg-black/50 hover:bg-green-600"
              } text-white rounded-full flex items-center justify-center text-sm`}
              disabled={isAvatarSpeaking}
              title={isListening ? "마이크 끄기" : "마이크 켜기"}
              onClick={toggleMicrophone}
            >
              {isListening ? "🎤" : "🎙️"}
            </button>

            {/* 상태 표시 */}
            <div className="absolute bottom-2 left-2 flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
              <span className="text-white text-xs bg-black/50 px-2 py-1 rounded">
                {getStatusText()}
              </span>
            </div>

            {/* 중간 인식 결과 표시 */}
            {interimTranscript && (
              <div className="absolute bottom-10 left-2 right-2">
                <div className="bg-black/70 text-white text-xs px-2 py-1 rounded">
                  🎤 &quot;{interimTranscript}&quot;
                </div>
              </div>
            )}
          </div>

          {/* 텍스트 입력 */}
          <div className="p-2 bg-zinc-800 border-t border-zinc-700">
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 bg-zinc-700 text-white text-sm rounded-lg border border-zinc-600 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                disabled={isLoading || isAvatarSpeaking}
                placeholder="또는 텍스트로 질문하세요..."
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && !e.shiftKey && handleSendMessage()
                }
              />
              <button
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-600 text-white text-sm rounded-lg"
                disabled={isLoading || isAvatarSpeaking || !inputText.trim()}
                onClick={handleSendMessage}
              >
                {isLoading ? "..." : "전송"}
              </button>
            </div>
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
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-full text-base font-medium shadow-lg"
              onClick={startSession}
            >
              🧠 AI 도우미 시작
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
