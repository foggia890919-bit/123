import { useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Audio } from 'expo-av';
import { useQueryClient } from '@tanstack/react-query';
import AudioRecorder from '../../components/AudioRecorder';
import { createSessionWithUpload } from '../../lib/supabase';
import { startProcessing } from '../../lib/deepgram';
import { useAudioStore } from '../../stores/useAudioStore';

// 16kHz mono AAC(m4a) — STT에 충분하면서 파일 크기를 최소화
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  android: {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android,
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY.ios,
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 64000,
  },
};

export default function RecordScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [uploading, setUploading] = useState(false);

  const isRecording = useAudioStore((s) => s.isRecording);
  const isPaused = useAudioStore((s) => s.isPaused);
  const beginRecording = useAudioStore((s) => s.beginRecording);
  const setPaused = useAudioStore((s) => s.setPaused);
  const updateRecordingStatus = useAudioStore((s) => s.updateRecordingStatus);
  const resetRecording = useAudioStore((s) => s.resetRecording);

  const handleStart = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('권한 필요', '녹음을 위해 마이크 권한을 허용해주세요.');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        RECORDING_OPTIONS,
        (status) =>
          updateRecordingStatus({
            isRecording: status.isRecording,
            durationMillis: status.durationMillis,
            metering: status.metering,
          }),
        200,
      );
      recordingRef.current = recording;
      beginRecording();
    } catch (err) {
      Alert.alert('녹음 시작 실패', err instanceof Error ? err.message : String(err));
    }
  };

  const handlePauseToggle = async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    try {
      if (isPaused) {
        await recording.startAsync();
        setPaused(false);
      } else {
        await recording.pauseAsync();
        setPaused(true);
      }
    } catch (err) {
      Alert.alert('오류', err instanceof Error ? err.message : String(err));
    }
  };

  const handleStop = async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    recordingRef.current = null;
    setUploading(true);
    try {
      const status = await recording.getStatusAsync();
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      resetRecording();
      if (!uri) throw new Error('녹음 파일 경로를 얻지 못했습니다');

      const sessionId = await createSessionWithUpload({
        localUri: uri,
        ext: 'm4a',
        title: '',
        sessionType: 'MEETING',
        durationSeconds: status.durationMillis
          ? Math.round(status.durationMillis / 1000)
          : null,
      });
      // 처리(STT+LLM)는 수 분이 걸릴 수 있으므로 백그라운드로 시작하고 즉시 이동
      startProcessing(sessionId);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      router.push(`/session/${sessionId}`);
    } catch (err) {
      Alert.alert(
        '업로드 실패',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-6 pb-4 pt-2">
        <Text className="text-2xl font-bold text-white">회의 녹음</Text>
        <Text className="text-sm text-muted">
          녹음이 끝나면 자동으로 AI 분석이 시작됩니다
        </Text>
      </View>
      <AudioRecorder
        isRecording={isRecording}
        isPaused={isPaused}
        uploading={uploading}
        onStart={handleStart}
        onPauseToggle={handlePauseToggle}
        onStop={handleStop}
      />
    </SafeAreaView>
  );
}
