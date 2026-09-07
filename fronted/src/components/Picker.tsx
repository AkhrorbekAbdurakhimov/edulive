import { useEffect, useId, useRef, useState } from 'react';

/**
 * Qidiruvli tanlagich (combobox).
 *
 * Nega oddiy <select> emas: ro'yxat uzun (yuzlab o'quvchi, minglab kitob) va
 * serverdan qidirib keltiriladi — <select> ni bunday ishlatib bo'lmaydi.
 *
 * Nega ro'yxat doim ochiq turmaydi: ikkita ochiq ro'yxat oynani ekrandan
 * uzun qilib yuboradi va telefonda "Berish" tugmasigacha yetib borish uchun
 * uzoq aylantirish kerak bo'ladi. Ro'yxat faqat kerak bo'lganda — maydon
 * bosilganda — ochiladi.
 */
export interface PickerProps<T> {
  label: string;
  placeholder?: string;
  help?: string;
  items: T[];
  loading?: boolean;
  /** Tanlanmagan bo'lsa bo'sh satr. */
  value: string;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getHint?: (item: T) => string;
  /** Foydalanuvchi yozganda chaqiriladi (kechiktirilgan). */
  onSearch: (q: string) => void;
  onSelect: (item: T | null) => void;
  emptyText?: string;
  required?: boolean;
}

export function Picker<T>({
  label, placeholder, help, items, loading, value,
  getKey, getLabel, getHint, onSearch, onSelect,
  emptyText = 'Topilmadi', required,
}: PickerProps<T>) {
  const id = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // Tanlagandan keyin maydonga fokus qaytaramiz (klaviatura bilan ishlash uchun),
  // lekin o'sha fokus ro'yxatni darhol qayta ochib yubormasligi kerak.
  const skipFocusOpen = useRef(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  /**
   * Tanlangan elementning nomi ALOHIDA saqlanadi, `items` dan olinmaydi.
   *
   * Sabab: ro'yxat serverdan sahifalab keladi (limit 20). Qidirib topilgan
   * o'quvchi tanlangandan keyin ro'yxat sukut holatiga qaytsa, u yerda
   * bo'lmasligi mumkin — nom `items` dan olinsa, tanlov ko'zdan yo'qolardi.
   */
  const [selectedLabel, setSelectedLabel] = useState('');

  // Tanlovni tashqaridan bekor qilishsa (masalan forma tozalansa) nom ham ketsin.
  useEffect(() => {
    if (!value && selectedLabel) { setSelectedLabel(''); setText(''); }
  }, [value, selectedLabel]);

  // Qidiruvni har bosishda emas, yozib bo'lgandan keyin jo'natamiz.
  useEffect(() => {
    if (text === selectedLabel) return;      // tanlovdan keyin qayta qidirmaymiz
    const t = setTimeout(() => onSearch(text.trim()), 250);
    return () => clearTimeout(t);
    // onSearch har renderda yangi funksiya bo'lishi mumkin — bog'liqlikka qo'shmaymiz
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, selectedLabel]);

  // Tashqariga bosilganda yopiladi. blur ishlatilmaydi: ro'yxatdagi tugmani
  // bosish blur'ni chaqiradi va tanlov amalga oshmay qolardi.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedLabel]);

  function close() {
    setOpen(false);
    // Tanlanmagan holda yozib qoldirilgan matn chalkashtiradi — tanlovga qaytaramiz.
    setText(selectedLabel);
    // Qidiruvni ham bo'shatamiz: aks holda keyingi safar ochganda ro'yxat
    // eski, mos kelmagan so'rov natijasi bilan (ya'ni bo'sh) ochilardi.
    onSearch('');
  }

  function pick(item: T) {
    onSelect(item);
    setSelectedLabel(getLabel(item));
    setText(getLabel(item));
    setOpen(false);
    skipFocusOpen.current = true;
    inputRef.current?.focus();
  }

  function clear() {
    onSelect(null);
    setSelectedLabel('');
    setText('');
    setOpen(true);
    onSearch('');
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      // Ro'yxat ochiq bo'lsa Escape faqat uni yopadi: modal ham Escape'ni
      // tinglaydi va to'xtatmasak, butun oyna yopilib ketardi.
      if (open) e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((a) => {
        const n = items.length;
        if (!n) return 0;
        return e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n;
      });
      return;
    }
    // Enter ro'yxatdan tanlaydi — formani yuborib yubormasin.
    if (e.key === 'Enter' && open && items[active]) {
      e.preventDefault();
      pick(items[active]);
    }
  }

  return (
    <div className="field picker" ref={boxRef}>
      <label htmlFor={id}>{label}</label>

      <div className="picker-input">
        <input
          id={id}
          ref={inputRef}
          className="input"
          placeholder={placeholder}
          value={text}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${id}-o${active}` : undefined}
          autoComplete="off"
          required={required && !value}
          onFocus={() => {
            if (skipFocusOpen.current) { skipFocusOpen.current = false; return; }
            setOpen(true);
            setActive(0);
          }}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
            // Yozish boshlangani — oldingi tanlov endi amal qilmaydi.
            if (value) { onSelect(null); setSelectedLabel(''); }
          }}
          onKeyDown={onKeyDown}
        />
        {value && (
          <button
            type="button" className="picker-clear" onClick={clear}
            aria-label="Tanlovni bekor qilish" title="Tanlovni bekor qilish"
          >
            ✕
          </button>
        )}
      </div>

      {help && <span className="help">{help}</span>}

      {open && (
        <div className="picker-list" id={`${id}-list`} role="listbox">
          {loading ? (
            <p className="muted">Qidirilmoqda…</p>
          ) : items.length === 0 ? (
            <p className="muted">{emptyText}</p>
          ) : (
            items.map((item, i) => {
              const k = getKey(item);
              return (
                <button
                  key={k}
                  id={`${id}-o${i}`}
                  type="button"
                  role="option"
                  aria-selected={k === value}
                  className={`pick${k === value ? ' on' : ''}${i === active ? ' active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(item)}
                >
                  <strong>{getLabel(item)}</strong>
                  {getHint && <span className="muted">{getHint(item)}</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
