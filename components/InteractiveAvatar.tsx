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
import { useEffect, useRef, useState } from "react";
import { useMemoizedFn, useUnmount } from "ahooks";

import { useStreamingAvatarSession } from "./logic/useStreamingAvatarSession";
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";

import { AVATARS } from "@/app/lib/constants";

const DEFAULT_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: AVATARS[0].avatar_id,
  // knowledgeId 제거 - OpenAI로 완전 제어
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
  const [isListening, setIsListening] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const mediaStream = useRef<HTMLVideoElement>(null);
  const isProcessingRef = useRef(false);

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

  // OpenAI API 호출 함수
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

  // 아바타가 말하게 하는 함수
  const speakWithAvatar = async (text: string) => {
    if (!avatarRef.current || !text) return;
    
    try {
      await avatarRef.current.speak({
        text: text,
        taskType: TaskType.TALK,
      });
    } catch (error) {
      console.error("Avatar speak error:", error);
    }
  };

  // 사용자 음성 처리 함수
  const handleUserSpeech = useMemoizedFn(async (transcript: string) => {
    if (!transcript.trim() || isProcessingRef.current) return;
    
    isProcessingRef.current = true;
    setIsLoading(true);
    
    console.log("User said:", transcript);
    
    // 채팅 히스토리에 사용자 메시지 추가
    const newHistory = [...chatHistory, { role: "user" as const, content: transcript }];
    setChatHistory(newHistory);
    
    // OpenAI API 호출
    const reply = await callOpenAI(transcript, chatHistory);
    console.log("OpenAI reply:", reply);
    
    // 채팅 히스토리에 응답 추가
    setChatHistory([...newHistory, { role: "assistant" as const, content: reply }]);
    
    // 아바타가 응답 말하기
    await speakWithAvatar(reply);
    
    setIsLoading(false);
    isProcessingRef.current = false;
  });

  const startSession = useMemoizedFn(async () => {
    try {
      const newToken = await fetchAccessToken();
      const avatarInstance = initAvatar(newToken);

      // 스트림 준비 이벤트
      avatarInstance.on(StreamingEvents.STREAM_READY, (event) => {
        console.log(">>>>> Stream ready:", event.detail);
      });
      
      // 스트림 연결 끊김 이벤트
      avatarInstance.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("Stream disconnected");
      });

      // 사용자 음성 인식 시작
      avatarInstance.on(StreamingEvents.USER_START, () => {
        console.log("User started speaking");
        setIsListening(true);
        setUserTranscript("");
      });

      // 사용자 음성 인식 종료
      avatarInstance.on(StreamingEvents.USER_STOP, () => {
        console.log("User stopped speaking");
        setIsListening(false);
      });

      // 사용자 음성 텍스트 수신 (핵심!)
      avatarInstance.on(StreamingEvents.USER_TALKING_MESSAGE, (event) => {
        const message = event.detail?.message;
        console.log("User transcript:", message);
        if (message) {
          setUserTranscript(message);
        }
      });

      // 사용자 발화 종료 후 최종 텍스트 처리
      avatarInstance.on(StreamingEvents.USER_END_MESSAGE, (event) => {
        const finalMessage = event.detail?.message;
        console.log("User final message:", finalMessage);
        if (finalMessage && finalMessage.trim()) {
          handleUserSpeech(finalMessage);
        }
      });

      // 아바타 세션 시작
      await startAvatar(config);

      // Voice Chat 시작 (마이크 활성화)
      await avatarInstance.startVoiceChat();
      console.log("Voice chat started - using OpenAI for responses");

      // 시작 인사
      setTimeout(async () => {
        const greeting = "안녕하세요! 차의과학대학교 경영학전공 AI 상담사 경영이입니다. 전공 선택, 취업, 커리큘럼 등 궁금한 점을 편하게 물어보세요!";
        await speakWithAvatar(greeting);
        setChatHistory([{ role: "assistant", content: greeting }]);
      }, 1500);
      
    } catch (error) {
      console.error("Error starting avatar session:", error);
    }
  });

  // 텍스트 입력 처리
  const handleSendMessage = useMemoizedFn(async () => {
    const textToSend = inputText.trim();
    if (!textToSend || !avatarRef.current || isLoading) return;

    setInputText("");
    setIsLoading(true);

    // 채팅 히스토리에 추가
    const newHistory = [...chatHistory, { role: "user" as const, content: textToSend }];
    setChatHistory(newHistory);

    // OpenAI API 호출
    const reply = await callOpenAI(textToSend, chatHistory);

    // 채팅 히스토리에 응답 추가
    setChatHistory([...newHistory, { role: "assistant" as const, content: reply }]);

    // 아바타가 응답 말하기
    await speakWithAvatar(reply);

    setIsLoading(false);
  });

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

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
    <div className="w-full h-full flex flex-col">
      {/* 아바타 영상 */}
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

            {/* 음성 인식 상태 표시 */}
            <div className="absolute bottom-2 left-2 flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isListening ? 'bg-red-500 animate-pulse' : isLoading ? 'bg-yellow-500' : 'bg-green-500'}`} />
              <span className="text-white text-xs bg-black/50 px-2 py-1 rounded">
                {isListening ? '듣는 중...' : isLoading ? '응답 생성 중...' : '말씀하세요'}
              </span>
            </div>

            {/* 실시간 음성 인식 텍스트 */}
            {userTranscript && (
              <div className="absolute bottom-12 left-2 right-2">
                <div className="bg-black/70 text-white text-sm px-3 py-2 rounded-lg">
                  🎤 {userTranscript}
                </div>
              </div>
            )}
          </div>

          {/* 텍스트 입력 (보조) */}
          <div className="p-2 bg-zinc-800 border-t border-zinc-700">
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 bg-zinc-700 text-white text-sm rounded-lg border border-zinc-600 focus:outline-none focus:border-purple-500 disabled:opacity-50"
                disabled={isLoading}
                placeholder="또는 텍스트로 질문하세요..."
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              <button
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-600 text-white text-sm rounded-lg transition-colors"
                disabled={isLoading || !inputText.trim()}
                onClick={() => handleSendMessage()}
              >
                {isLoading ? "..." : "전송"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* 시작 전 / 로딩 화면 */
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
              💬 상담 시작
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
