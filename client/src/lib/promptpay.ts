/**
 * lib/promptpay.ts — Détection & parsing des QR Thai PromptPay (EMVCo QRCPS)
 * Fait partie de Thârk.
 */

export type PromptPayInfo = {
  merchantName?: string;
  amountThb?: number;
  isStatic: boolean;
  crcValid: boolean;
  raw: string;
};

const PROMPTPAY_AIDS = ["A000000677010111", "A000000677010112", "A000000677010114"];

type TlvMap = Map<string, string>;

const parseTlv = (payload: string): TlvMap | null => {
  const map: TlvMap = new Map();
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    if (Number.isNaN(len) || i + 4 + len > payload.length) return null;
    map.set(id, payload.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return i === payload.length ? map : null;
};

const crc16 = (input: string): number => {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
};

export const isPromptPayQR = (value: string): boolean => {
  const v = value.trim();
  if (!v.startsWith("000201")) return false;
  const tlv = parseTlv(v);
  if (!tlv) return false;
  for (const tag of ["29", "30", "26", "27", "28", "31"]) {
    const sub = tlv.get(tag);
    if (sub) {
      const subTlv = parseTlv(sub);
      const aid = subTlv?.get("00")?.toUpperCase();
      if (aid && PROMPTPAY_AIDS.includes(aid)) return true;
    }
  }
  return tlv.get("58") === "TH" && tlv.get("53") === "764";
};

export const parsePromptPay = (value: string): PromptPayInfo | null => {
  const v = value.trim();
  if (!isPromptPayQR(v)) return null;
  const tlv = parseTlv(v);
  if (!tlv) return null;
  const amountStr = tlv.get("54");
  const amountThb = amountStr ? parseFloat(amountStr) : undefined;
  let crcValid = false;
  const crcIdx = v.lastIndexOf("6304");
  if (crcIdx !== -1 && crcIdx + 8 === v.length) {
    const expected = parseInt(v.slice(crcIdx + 4), 16);
    crcValid = crc16(v.slice(0, crcIdx + 4)) === expected;
  }
  return {
    merchantName: tlv.get("59"),
    amountThb: amountThb && !Number.isNaN(amountThb) ? amountThb : undefined,
    isStatic: amountThb === undefined,
    crcValid,
    raw: v,
  };
};

export const extractBolt11 = (text: string): string | null => {
  const match = text.match(/ln(bc|tb|bcrt)[0-9]{1,}[a-z0-9]{50,}/i);
  return match ? match[0].toLowerCase() : null;
};
