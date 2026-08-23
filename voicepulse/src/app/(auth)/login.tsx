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
import { Link } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('입력 확인', '이메일과 비밀번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) {
      Alert.alert('로그인 실패', error.message);
    }
    // 성공 시 onAuthStateChange → 루트 가드가 (tabs)로 이동
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <View className="flex-1 justify-center px-8">
        <Text className="mb-1 text-4xl font-bold text-white">VoicePulse</Text>
        <Text className="mb-10 text-base text-muted">
          녹음하면, AI가 회의를 정리합니다
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

        <Text className="mb-2 text-sm text-muted">비밀번호</Text>
        <TextInput
          className="mb-8 rounded-xl border border-border bg-surface px-4 py-3 text-white"
          placeholder="••••••••"
          placeholderTextColor="#5A6478"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <Pressable
          className="items-center rounded-xl bg-primary py-4 active:opacity-80"
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-base font-semibold text-white">로그인</Text>
          )}
        </Pressable>

        <View className="mt-6 flex-row justify-center">
          <Text className="text-muted">계정이 없으신가요? </Text>
          <Link href="/(auth)/register" asChild>
            <Pressable>
              <Text className="font-semibold text-accent">회원가입</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
