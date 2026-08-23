import { Redirect } from 'expo-router';

// 루트 진입 시 탭으로 리다이렉트 — 미로그인이면 _layout의 가드가 로그인으로 보냄
export default function Index() {
  return <Redirect href="/(tabs)" />;
}
