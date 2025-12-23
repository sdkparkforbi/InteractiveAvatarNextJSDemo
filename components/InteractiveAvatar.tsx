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

import { useStreamingAvatarSession } from "./logic/useStreamingAvatarSession";
import { useVoiceChat } from "./logic/useVoiceChat";
import { StreamingAvatarProvider, StreamingAvatarSessionState } from "./logic";

import { AVATARS } from "@/app/lib/constants";

const DEFAULT_CONFIG: StartAvatarRequest = {
  quality: AvatarQuality.Low,
  avatarName: AVATARS[0].avatar_id,
  knowledgeId: undefined,
  voice: {
    rate: 1.5,
    emotion: VoiceEmotion.EXCITED,
    model: ElevenLabsModel.eleven_flash_v2_5,
  },
  language: "Korean",
  voiceChatTransport: VoiceChatTransport.WEBSOCKET,
  sttSettings: {
    provider: STTProvider.DEEPGRAM,
  },
};

function InteractiveAvatar() {
  const { initAvatar, startAvatar, stopAvatar, sessionState, stream } =
    useStreamingAvatarSession();
  const { startVoiceChat } = useVoiceChat();

  const [config] = useState<StartAvatarRequest>(DEFAULT_CONFIG);
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

      avatar.on(StreamingEvents.STREAM_READY, (event) => {
        console.log(">>>>> Stream ready:", event.detail);
      });
      avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("Stream disconnected");
      });

      await startAvatar(config);

      if (isVoiceChat) {
        await startVoiceChat();
      }
    } catch (error) {
      console.error("Error starting avatar session:", error);
    }
  });

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
    <div className="w-full h-full bg-black relative">
      {/* 아바타 영상 */}
      {sessionState === StreamingAvatarSessionState.CONNECTED && stream ? (
        <video
          ref={mediaStream}
          autoPlay
          playsInline
          className="w-full h-full object-contain"
        />
      ) : (
        /* 시작 전 / 로딩 화면 */
        <div className="w-full h-full flex items-center justify-center">
          {sessionState === StreamingAvatarSessionState.CONNECTING ? (
            /* 로딩 중 */
            <div className="flex flex-col items-center gap-3 text-white">
              <div className="w-10 h-10 border-3 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm">연결 중...</span>
            </div>
          ) : (
            /* 시작 버튼 */
            <div className="flex flex-col items-center gap-4">
              <button
                onClick={() => startSessionV2(true)}
                className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-full text-base font-medium transition-all shadow-lg hover:shadow-xl"
              >
                🎤 음성 상담 시작
              </button>
              <button
                onClick={() => startSessionV2(false)}
                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded-full transition-all"
              >
                ⌨️ 텍스트 상담
              </button>
            </div>
          )}
        </div>
      )}

      {/* 종료 버튼 - 우측 상단에 작게 */}
      {sessionState === StreamingAvatarSessionState.CONNECTED && (
        <button
          onClick={() => stopAvatar()}
          className="absolute top-2 right-2 w-8 h-8 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center text-sm transition-all"
          title="종료"
        >
          ✕
        </button>
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
