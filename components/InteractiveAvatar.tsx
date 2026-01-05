/**
 * ================================================
 * InteractiveAvatar.tsx - 경영학전공 탭별 설명 아바타
 * ================================================
 *
 * 흐름:
 * 1. 메인 페이지(index.html)에서 탭 클릭
 * 2. postMessage로 TAB_CHANGED 수신
 * 3. route.ts API 호출 (type: "tab_explain")
 * 4. 반환된 스크립트로 avatar.speak(REPEAT)
 *
 * ================================================
 */

import {
  AvatarQuality,
  StreamingEvents,
  VoiceChatTransport,
  VoiceEmotion,
  StartAvatarRequest,
  STTProvider,
  ElevenLabsModel,
  TaskType,
} from "@heygen/streaming-avatar";
import { useEffect, useRef, useState, useCallback } from "react";
import { useMemoizedFn, useUnmount } from "ahooks";

import { useStreamingAvatarSession } from "./logic/useStreamingAvatarSession";
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";

import { AVATARS } from "@/app/lib/constants";

const DEFAULT_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: AVATARS[0].avatar_id,
  voice: {
    rate: 1.5,
    emotion: VoiceEmotion.EXCITED,
    model: ElevenLabsModel.eleven_flash_v2_5,
  },
  language: "ko",
  voiceChatTransport: VoiceChatTransport.WEBSOCKET,
  sttSettings: {
    provider: STTProvider.DEEPGRAM,
  },
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

  const [config] = useState<StartAvatarRequest>(DEFAULT_CONFIG);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  const [currentTab, setCurrentTab] = useState<string>("");
  const mediaStream = useRef<HTMLVideoElement>(null);
  const isProcessingRef = useRef(false);
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

  // 🎯 탭 설명 API 호출 (고정 스크립트 반환)
  const fetchTabScript = async (tabId: string): Promise<string> => {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "tab_explain",
          tabId: tabId,
        }),
      });
      const data = await response.json();
      return data.reply || "설명을 불러올 수 없습니다.";
    } catch (error) {
      console.error("Tab script API error:", error);
      return "죄송합니다. 오류가 발생했습니다.";
    }
  };

  // 💬 일반 채팅 API 호출 (OpenAI)
  const callOpenAI = async (message: string, history: ChatMessage[]) => {
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message,
          history: history,
        }),
      });
      const data = await response.json();
      return data.reply;
    } catch (error) {
      console.error("OpenAI API error:", error);
      return "죄송합니다. 일시적인 오류가 발생했습니다. 다시 말씀해 주세요.";
    }
  };

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
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

      console.log("📑 Tab changed:", tabId);
      setCurrentTab(tabId);
      setIsLoading(true);

      // 현재 발화 중이면 중단
      if (avatarRef.current) {
        try {
          await avatarRef.current.interrupt();
        } catch {
          // ignore
        }
      }

      // API에서 스크립트 가져오기
      const script = await fetchTabScript(tabId);
      
      // 아바타로 발화
      await speakWithAvatar(script);

      setIsLoading(false);
      isProcessingRef.current = false;
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
          setChatHistory([{ role: "assistant", content: greeting }]);
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
  // 💬 텍스트 메시지 전송 (OpenAI 대화)
  // ============================================
  const handleSendMessage = useMemoizedFn(async () => {
    const textToSend = inputText.trim();
    if (!textToSend || !avatarRef.current || isLoading) return;

    setInputText("");
    setIsLoading(true);

    const newHistory = [...chatHistory, { role: "user" as const, content: textToSend }];
    setChatHistory(newHistory);

    const reply = await callOpenAI(textToSend, chatHistory);

    setChatHistory([...newHistory, { role: "assistant" as const, content: reply }]);

    await speakWithAvatar(reply);

    setIsLoading(false);
  });

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

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

          {/* 텍스트 입력 (추가 질문용) */}
          <div className="p-2 bg-zinc-800 border-t border-zinc-700">
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 bg-zinc-700 text-white text-sm rounded-lg border border-zinc-600 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                disabled={isLoading || isAvatarSpeaking}
                placeholder="추가 질문이 있으시면 입력하세요..."
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              <button
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-600 text-white text-sm rounded-lg transition-colors"
                disabled={isLoading || isAvatarSpeaking || !inputText.trim()}
                onClick={() => handleSendMessage()}
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
