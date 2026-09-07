import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { api, saveToken, saveUser, type AuthedUser } from '../api';
import { useTheme } from '../theme';
import { BigButton, Field, Icon } from '../ui';

export function LoginScreen({ onLogin }: { onLogin: (u: AuthedUser) => void }) {
  const c = useTheme();
  const [phone, setPhone] = useState('+998');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const data = await api<{ token: string; user: AuthedUser }>('/auth/login', 'POST', {
        phone: phone.replace(/\s/g, ''),
        password,
      });
      // Ilova faqat o'qituvchi uchun (DESIGN_PROMPT §6). Admin web'da ishlaydi.
      if (data.user.role !== 'teacher') {
        setError("Bu ilova faqat o'qituvchilar uchun. Administrator va menejer web orqali kiradi.");
        return;
      }
      await saveToken(data.token);
      await saveUser(data.user);
      onLogin(data.user);
    } catch (err: any) {
      setError(err?.message ?? 'Kirishda xatolik');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.page }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <Icon name="check-square" size={22} color="#fff" />
        </View>
        <Text style={{ fontSize: 26, fontWeight: '700', color: c.t1, letterSpacing: -0.5 }}>EduLive</Text>
        <Text style={{ fontSize: 14, color: c.t2, marginTop: 4, marginBottom: 28 }}>O'qituvchi ilovasi</Text>

        <View style={{ gap: 14 }}>
          <Field
            label="Telefon raqam"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoComplete="tel"
            placeholder="+998901234567"
            error={!!error}
          />
          <Field
            label="Parol"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            onSubmitEditing={submit}
            returnKeyType="go"
            error={!!error}
          />
        </View>

        {error && (
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 10 }}>
            <Icon name="alert-circle" size={14} color={c.critInk} />
            <Text style={{ color: c.critInk, fontSize: 13, flex: 1 }}>{error}</Text>
          </View>
        )}

        <View style={{ marginTop: 20 }}>
          <BigButton title={busy ? 'Kirilmoqda…' : 'Kirish'} onPress={submit} busy={busy} disabled={password.length === 0} />
        </View>
        <Text style={{ color: c.t3, fontSize: 12, textAlign: 'center', marginTop: 16 }}>
          Parolni maktab administratori beradi.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
