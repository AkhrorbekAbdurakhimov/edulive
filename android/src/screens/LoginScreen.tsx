import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { api, saveToken } from '../api';
import { light, radius } from '../theme';
import { BigButton } from '../ui';

type Palette = typeof light;

export interface AuthedUser {
  id: string;
  fullName: string;
  role: string;
}

export function LoginScreen({ c, onLogin }: { c: Palette; onLogin: (u: AuthedUser) => void }) {
  const [phone, setPhone] = useState('+998');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const data = await api<{ token: string; user: AuthedUser & { role: string } }>(
        '/auth/login', 'POST', { phone: phone.trim(), password },
      );
      if (data.user.role !== 'teacher') {
        setError("Bu ilova faqat o'qituvchilar uchun. Administrator web orqali kiradi");
        return;
      }
      await saveToken(data.token);
      onLogin(data.user);
    } catch (err: any) {
      setError(err?.message ?? 'Kirishda xatolik');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    height: 48, borderWidth: 1, borderColor: error ? c.crit : c.border,
    borderRadius: radius.control, paddingHorizontal: 14, color: c.t1,
    backgroundColor: c.surface, fontSize: 16,
  } as const;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: c.page }}
    >
      <Text style={{ fontSize: 26, fontWeight: '700', color: c.brandInk, letterSpacing: -0.4 }}>
        EduLive
      </Text>
      <Text style={{ fontSize: 14, color: c.t2, marginTop: 4, marginBottom: 24 }}>
        O'qituvchi ilovasi
      </Text>

      <Text style={{ fontSize: 13, fontWeight: '500', color: c.t2, marginBottom: 6 }}>Telefon raqam</Text>
      <TextInput
        value={phone} onChangeText={setPhone} keyboardType="phone-pad"
        autoCapitalize="none" style={[inputStyle, { marginBottom: 14 }]}
        placeholderTextColor={c.t3} placeholder="+998901234567"
      />
      <Text style={{ fontSize: 13, fontWeight: '500', color: c.t2, marginBottom: 6 }}>Parol</Text>
      <TextInput
        value={password} onChangeText={setPassword} secureTextEntry
        style={[inputStyle, { marginBottom: 8 }]}
      />
      {error && <Text style={{ color: c.critInk, fontSize: 13, marginBottom: 8 }}>{error}</Text>}

      <View style={{ marginTop: 12 }}>
        <BigButton title={busy ? 'Kirilmoqda…' : 'Kirish'} onPress={submit} c={c} busy={busy} disabled={!password} />
      </View>
    </KeyboardAvoidingView>
  );
}
