import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleRegister = async () => {
    if (!email.trim() || !password) {
      Alert.alert('입력 확인', '이메일과 비밀번호를 입력해주세요.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('입력 확인', '비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('입력 확인', '비밀번호가 일치하지 않습니다.');
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) {
      Alert.alert('회원가입 실패', error.message);
      return;
    }
    if (!data.session) {
      // 이메일 확인이 켜져 있는 프로젝트의 경우
      Alert.alert(
        '이메일 확인',
        '가입 확인 메일을 보냈습니다. 메일함을 확인한 뒤 로그인해주세요.',
        [{ text: '확인', onPress: () => router.replace('/(auth)/login') }],
      );
    }
    // 세션이 바로 생기면 루트 가드가 (tabs)로 이동
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <View className="flex-1 justify-center px-8">
        <Text className="mb-1 text-3xl font-bold text-white">회원가입</Text>
        <Text className="mb-10 text-base text-muted">
          VoicePulse 계정을 만들어보세요
        </Text>

        <Text className="mb-2 text-sm text-muted">이메일</Text>
        <TextInput
          className="mb-4 rounded-xl border border-border bg-surface px-4 py-3 text-white"
          placeholder="you@example.com"
          placeholderTextColor="#5A6478"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <Text className="mb-2 text-sm text-muted">비밀번호 (6자 이상)</Text>
        <TextInput
          className="mb-4 rounded-xl border border-border bg-surface px-4 py-3 text-white"
          placeholder="••••••••"
          placeholderTextColor="#5A6478"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <Text className="mb-2 text-sm text-muted">비밀번호 확인</Text>
        <TextInput
          className="mb-8 rounded-xl border border-border bg-surface px-4 py-3 text-white"
          placeholder="••••••••"
          placeholderTextColor="#5A6478"
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
        />

        <Pressable
          className="items-center rounded-xl bg-primary py-4 active:opacity-80"
          onPress={handleRegister}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-base font-semibold text-white">가입하기</Text>
          )}
        </Pressable>

        <View className="mt-6 flex-row justify-center">
          <Text className="text-muted">이미 계정이 있으신가요? </Text>
          <Link href="/(auth)/login" asChild>
            <Pressable>
              <Text className="font-semibold text-accent">로그인</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
