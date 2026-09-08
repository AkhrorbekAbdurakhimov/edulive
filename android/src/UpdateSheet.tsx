import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from './theme';
import { Banner, BigButton, Icon, Sheet } from './ui';
import { dismissUpdate, downloadAndInstall, type UpdateInfo } from './update';

const mb = (b: number) => `${(b / 1048576).toFixed(0)} MB`;

/** Yangi versiya oynasi: yuklab olish progressi + tizim o'rnatuvchisi. */
export function UpdateSheet({ info, open, onClose }: { info: UpdateInfo; open: boolean; onClose: () => void }) {
  const c = useTheme();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null && progress < 1;

  const install = async () => {
    setError(null);
    setProgress(0);
    try {
      await downloadAndInstall(info, setProgress);
      setProgress(1);
    } catch (err: any) {
      setError(err?.message ?? 'Xatolik');
      setProgress(null);
    }
  };

  const later = async () => {
    await dismissUpdate(info.versionCode);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={() => !busy && onClose()}
      title="Yangi versiya mavjud"
      sub={`EduLive ${info.version} (build ${info.versionCode}) · ${mb(info.sizeBytes)}`}
    >
      <Text style={{ fontSize: 13, color: c.t2, lineHeight: 19 }}>
        Ilova yangilanishni o'zi yuklab oladi, keyin Android o'rnatishni tasdiqlashni so'raydi.
        Kirish va navbatdagi davomat saqlanib qoladi.
      </Text>

      {progress !== null && (
        <View style={{ marginTop: 14 }}>
          <View style={{ height: 6, borderRadius: 99, backgroundColor: c.surface3, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(progress * 100)}%`, height: '100%', backgroundColor: c.brand, borderRadius: 99 }} />
          </View>
          <Text style={{ fontSize: 12, color: c.t3, marginTop: 6, fontVariant: ['tabular-nums'] }}>
            {progress < 1 ? `Yuklanmoqda… ${Math.round(progress * 100)}%` : "Yuklandi — o'rnatishni tasdiqlang"}
          </Text>
        </View>
      )}

      {error && (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 10 }}>
          <Icon name="alert-circle" size={14} color={c.critInk} />
          <Text style={{ color: c.critInk, fontSize: 13, flex: 1 }}>{error}</Text>
        </View>
      )}

      <View style={{ marginTop: 14, gap: 8 }}>
        <BigButton
          title={busy ? 'Yuklanmoqda…' : progress === 1 ? "Qayta o'rnatish" : "Yuklab olib o'rnatish"}
          icon="download"
          onPress={install}
          busy={busy}
        />
        <BigButton title="Keyinroq" variant="secondary" height={44} onPress={later} disabled={busy} />
      </View>
    </Sheet>
  );
}

/** "Keyinroq" deyilgandan keyin ham eslatib turadi — yangilanish yo'qolib qolmaydi. */
export function UpdateBanner({ info, onPress }: { info: UpdateInfo; onPress: () => void }) {
  return (
    <Banner
      kind="brand"
      icon="download"
      text={`Yangi versiya ${info.version} (build ${info.versionCode}) mavjud`}
      action={{ label: 'Yangilash', onPress }}
    />
  );
}
