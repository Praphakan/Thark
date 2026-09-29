/**
 * Thârk ↔ OpenPleb — Module de connexion au pont PromptPay/Lightning.
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";
import { mmkv } from "./mmkv";
import { payLightningInvoice, bolt11Invoice } from "./paymentsApi";
import { Wallet, Mint, getDecodedToken, getTokenMetadata, getEncodedToken } from "@cashu/cashu-ts";

// ── Configuration du serveur ────────────────────────────────
export const OPENPLEB_BASE_URL = "https://2-58-82-83.sslip.io";
export const OPENPLEB_API = `${OPENPLEB_BASE_URL}/api/v1`;

// ── Identité maker (paire de clés secp256k1 persistante) ────
const MAKER_PRIVKEY_STORAGE_KEY = "openpleb.maker.privkey";

function getMakerPrivKeyHex(): string {
  let hex = mmkv.getString(MAKER_PRIVKEY_STORAGE_KEY);
  if (!hex) {
    const { secretKey } = secp256k1.keygen();
    hex = bytesToHex(secretKey);
    mmkv.set(MAKER_PRIVKEY_STORAGE_KEY, hex);
  }
  // Le backend reconstruit la clé publique du maker en "02" + x : la clé doit
  // donc avoir une parité paire. Sinon on prend la clé opposée (même x, préfixe 02).
  {
    const priv = Uint8Array.from(hex!.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    if (secp256k1.getPublicKey(priv, true)[0] === 3) {
      const N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
      hex = ((N - BigInt("0x" + hex)) % N).toString(16).padStart(64, "0");
      mmkv.set(MAKER_PRIVKEY_STORAGE_KEY, hex);
    }
  }
  return hex;
}

export function getMakerPubKey(): string {
  const privHex = getMakerPrivKeyHex();
  const priv = Uint8Array.from(
    privHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)),
  );
  const pub = secp256k1.getPublicKey(priv, true);
  return bytesToHex(pub);
}

// ── Types ───────────────────────────────────────────────────
export interface OpenPlebOffer {
  id: number;
  qrCode: string;
  amount: number;
  satsAmount: number;
  status: string;
  invoice?: string;
  pubkey: string;
  createdAt: number;
}

export interface CreateOfferParams {
  qrCode: string;
  amountThb: number;
  fiatProviderId?: number;
}

// ── Appels API ──────────────────────────────────────────────
export async function getConversion(): Promise<number> {
  const res = await fetch(`${OPENPLEB_API}/conversion`);
  if (!res.ok) throw new Error(`conversion HTTP ${res.status}`);
  const data = await res.json();
  return data.conversion;
}

export async function createOffer(
  params: CreateOfferParams,
): Promise<OpenPlebOffer> {
  const body = {
    qrCode: params.qrCode,
    amount: params.amountThb,
    pubkey: getMakerPubKey().slice(2), // le backend ajoute le préfixe '02'
    ...(params.fiatProviderId != null
      ? { fiatProviderId: params.fiatProviderId }
      : {}),
  };
  const res = await fetch(`${OPENPLEB_API}/offers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`createOffer HTTP ${res.status}: ${txt}`);
  }
  const data = await res.json();
  // le backend renvoie { offer: {...} }
  return data?.offer ?? data;
}

export async function getOfferInvoice(offerId: number): Promise<string> {
  const res = await fetch(`${OPENPLEB_API}/offers/${offerId}/createinvoice`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`getOfferInvoice HTTP ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const invoice = data?.offer?.invoice ?? data?.invoice;
  if (!invoice) throw new Error("Aucune facture retournée par le serveur");
  return invoice;
}

export async function checkInvoicePaid(offerId: number): Promise<unknown> {
  const res = await fetch(`${OPENPLEB_API}/offers/${offerId}/checkpaidinvoice`);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`checkInvoicePaid HTTP ${res.status}: ${txt}`);
  }
  return res.json();
}

export async function getFiatProviders(): Promise<unknown> {
  const res = await fetch(`${OPENPLEB_API}/fiat-providers`);
  if (!res.ok) throw new Error(`fiat-providers HTTP ${res.status}`);
  return res.json();
}

/**
 * Paie la facture Lightning d'une offre avec le solde Ark/Lightning de Thârk.
 * @param invoice  la facture bolt11 (lnbc...) obtenue via getOfferInvoice()
 * @returns true si le paiement a réussi
 */
export async function payOfferInvoice(invoice: string): Promise<boolean> {
  const result = await payLightningInvoice(invoice, undefined);
  if (result.isErr()) {
    throw new Error(`Paiement échoué: ${result.error.message}`);
  }
  return true;
}

/**
 * Encaisse un token de remboursement ecash (offer.refund) vers le wallet Ark.
 * Fait un "melt" Cashu : le mint paie une facture Lightning que Thârk génère,
 * les sats reviennent donc dans le solde Ark. Souverain — ne dépend pas du backend.
 * @param refundToken le token ecash (cashuA...) du champ offer.refund
 * @returns le nombre de sats récupérés
 */

/**
 * Fonction de requête custom pour cashu-ts, basée sur le fetch natif RN.
 * Contourne les soucis de POST de la lib en React Native.
 */
async function cashuFetch<T = unknown>(args: any): Promise<T> {
  const { endpoint, requestBody, headers } = args;
  const method = requestBody ? "POST" : "GET";
  const res = await fetch(endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(headers ?? {}),
    },
    body: requestBody ? JSON.stringify(requestBody, (_k, v) => (typeof v === "bigint" ? Number(v) : _k === "amount" && typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v)) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }
  return (await res.json()) as T;
}

export async function redeemRefundToken(refundToken: string): Promise<number> {
  // 1. Décoder le token (mint + proofs)
  // Nouveau format de keyset : le jeton ne contient qu'un ID abrégé,
  // il faut la liste des keysets du mint pour le décoder.
  const meta = getTokenMetadata(refundToken);
  const ksRes = await fetch(`${meta.mint.replace(/\/$/, "")}/v1/keysets`);
  if (!ksRes.ok) throw new Error(`Keysets du mint indisponibles (HTTP ${ksRes.status})`);
  const ksIds: string[] = (await ksRes.json()).keysets.map((k: any) => k.id);
  const decoded = getDecodedToken(refundToken, ksIds);
  const mintUrl = decoded.mint;
  if (!mintUrl) throw new Error("Pas de mint dans le token: " + JSON.stringify(Object.keys(decoded)));
  const proofs = decoded.proofs;
  const totalSats = proofs.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
  if (totalSats <= 0) throw new Error("Token de remboursement vide");

  // 1b. GARDE-FOU : vérifier que les proofs P2PK correspondent à NOTRE clé
  //     (évite de tenter un melt voué à échouer et de bloquer les proofs)
  const myPub = getMakerPubKey(); // "02xxxx"
  const firstSecret = (proofs[0] as any)?.secret;
  if (typeof firstSecret === "string" && firstSecret.includes("P2PK")) {
    const m = firstSecret.match(/"data":"([0-9a-fA-F]+)"/);
    const lockedTo = m ? m[1] : "";
    if (lockedTo !== myPub) {
      throw new Error(`P2PK verrouillé pour ${lockedTo.slice(0,12)}... mais ma clé est ${myPub.slice(0,12)}... — non récupérable`);
    }
  }

  // 2. Wallet Cashu sur le mint émetteur
  const mint = new Mint(mintUrl, { customRequest: cashuFetch });
  const wallet = new Wallet(mint);
  try { await wallet.loadMint(); } catch (e: any) { throw new Error("loadMint: " + (e?.message ?? e)); }

  // 3. Facture-sonde pour estimer les frais de melt (bolt11Invoice attend des SATS)
  const probeRes = await bolt11Invoice(totalSats);
  if (probeRes.isErr()) throw new Error("Sonde: " + probeRes.error.message);
  const probeInvoice = probeRes.value.payment_request;
  if (!probeInvoice || typeof probeInvoice !== "string") throw new Error("Facture invalide: " + JSON.stringify(probeRes.value));
  if (!probeInvoice.toLowerCase().startsWith("lnbc")) throw new Error("Facture pas lnbc: " + probeInvoice.slice(0, 30));
  let probeQuote: any;
  try { probeQuote = await wallet.createMeltQuoteBolt11(probeInvoice); } catch (e: any) { throw new Error("meltQuote: " + (e?.message ?? e)); }
  const fee = Number(probeQuote.fee_reserve ?? 0);

  // 4. Montant net = total - frais
  const amountToReceive = Number(totalSats) - Number(fee);
  if (amountToReceive <= 0) throw new Error("Frais trop élevés pour le remboursement");

  // 5. Vraie facture au montant net (en SATS)
  const realRes = await bolt11Invoice(amountToReceive);
  if (realRes.isErr()) throw new Error("Génération facture finale impossible");
  const realInvoice = realRes.value.payment_request;
  const meltQuote = await wallet.createMeltQuoteBolt11(realInvoice);

  // 6. Melt : le mint paie la facture Thârk avec les proofs.
  //    On passe la clé privée maker pour déverrouiller l'ecash P2PK
  //    (le refund/caution est chiffré pour notre clé publique).
  const privkey = getMakerPrivKeyHex();
  try { await wallet.meltProofsBolt11(meltQuote, proofs as any, { privkey }); } catch (e: any) {
    const msg = String(e?.message ?? e);
    // Certains mints (ex. Minibits) refusent les factures Ark : on passe par un mint pont.
    if (msg.includes("Invalid payment request")) {
      return await bridgeToArk(wallet, proofs as any, totalSats, privkey, String((proofs[0] as any)?.C ?? "x").slice(0, 16));
    }
    throw new Error("melt: " + msg + " | facture: " + realInvoice);
  }

  return amountToReceive;
}

/**
 * Recupere une offre complete (avec son champ refund) par son id.
 */
export async function getOffer(offerId: number): Promise<any> {
  const res = await fetch(`${OPENPLEB_API}/offers/${offerId}`);
  if (!res.ok) throw new Error(`getOffer HTTP ${res.status}`);
  const data = await res.json();
  return data?.offer ?? data;
}

/**
 * Recupere l'offre, et si elle a expire avec un refund, encaisse ce refund.
 * Retourne le nombre de sats recuperes, ou 0 si pas de refund.
 */
export async function redeemOfferRefundIfAny(offerId: number): Promise<number> {
  const offer = await getOffer(offerId);
  if (!offer?.refund) return 0;
  return await redeemRefundToken(offer.refund);
}

// ── Suivi des offres en attente de remboursement ────────────
const PENDING_OFFERS_KEY = "openpleb.pending.offers";

/** Ajoute un id d'offre à surveiller pour un éventuel remboursement. */
export function addPendingOffer(offerId: number): void {
  const raw = mmkv.getString(PENDING_OFFERS_KEY);
  const list: number[] = raw ? JSON.parse(raw) : [];
  if (!list.includes(offerId)) {
    list.push(offerId);
    mmkv.set(PENDING_OFFERS_KEY, JSON.stringify(list));
  }
}

/** Retire un id d'offre de la liste de surveillance. */
export function removePendingOffer(offerId: number): void {
  const raw = mmkv.getString(PENDING_OFFERS_KEY);
  const list: number[] = raw ? JSON.parse(raw) : [];
  const next = list.filter((id) => id !== offerId);
  mmkv.set(PENDING_OFFERS_KEY, JSON.stringify(next));
}

/** Liste des offres en attente. */
export function getPendingOffers(): number[] {
  const raw = mmkv.getString(PENDING_OFFERS_KEY);
  return raw ? JSON.parse(raw) : [];
}

/**
 * Parcourt les offres en attente et encaisse tout remboursement disponible.
 * À appeler au démarrage de l'app. Retourne le total de sats récupérés.
 */
let refundsInFlight = false;
export async function processPendingRefunds(): Promise<number> {
  if (refundsInFlight) return 0;
  refundsInFlight = true;
  try {
  const list = getPendingOffers();
  let total = 0;
  for (const offerId of list) {
    try {
      const sats = await redeemOfferRefundIfAny(offerId);
      if (sats > 0) {
        total += sats;
        removePendingOffer(offerId);
      } else {
        // Vérifier si l'offre est résolue (taker) ou encore active
        const offer = await getOffer(offerId);
        if (offer?.status && !["CREATED", "INVOICE_CREATED", "INVOICE_PAID", "CLAIMED", "RECEIPT_SUBMITTED", "MARKED_WITH_ISSUE", "FOREFEIT"].includes(offer.status) && !offer.refund) {
          // résolue autrement (taker) ou plus rien à récupérer
          removePendingOffer(offerId);
        }
      }
    } catch (e: any) {
      // on réessaiera au prochain démarrage
      console.warn("[refund] offre", offerId, ":", e?.message ?? String(e));
    }
  }
  return total;
  } finally {
    refundsInFlight = false;
  }
}

// ── TEMP : test de compatibilité mint ↔ factures Ark ────────
async function testMintArkCompat(mintUrl: string, amount = 50): Promise<string> {
  const mint = new Mint(mintUrl, { customRequest: cashuFetch });
  const wallet = new Wallet(mint);
  await wallet.loadMint();
  const mq = await wallet.createMintQuoteBolt11(amount);
  await payOfferInvoice(mq.request); // Thârk paie le mint
  for (let i = 0; i < 20; i++) {
    const st = await wallet.checkMintQuoteBolt11(mq.quote);
    if (String(st.state) !== "UNPAID") break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const proofs = await wallet.mintProofsBolt11(amount, mq.quote);
  mmkv.set(`debug.minttest.${mintUrl}`, getEncodedToken({ mint: mintUrl, proofs }));
  const inv = await bolt11Invoice(amount - 10);
  if (inv.isErr()) return "❌ facture Ark impossible";
  const mlt = await wallet.createMeltQuoteBolt11(inv.value.payment_request);
  try {
    await wallet.meltProofsBolt11(mlt, proofs as any);
  } catch (e: any) {
    return "❌ melt vers Ark refusé : " + (e?.message ?? String(e));
  }
  mmkv.set(`debug.minttest.${mintUrl}`, "");
  return `✅ le mint a payé la facture Ark (${amount - 10} sats reçus)`;
}

export async function runMintArkTestsOnce(): Promise<void> {
  if (mmkv.getString("debug.minttest.done2")) return;
  mmkv.set("debug.minttest.done2", "1");
  for (const m of ["https://mint.cubabitcoin.org", "https://mint.macadamia.cash"]) {
    try { console.warn(`[minttest] ${m} :`, await testMintArkCompat(m)); }
    catch (e: any) { console.warn(`[minttest] ${m} : ❌ ${e?.message ?? String(e)}`); }
  }
}


// ── Pont vers Ark via un mint capable de payer les factures Ark ──
const BRIDGE_MINT_URL = "https://mint.cubabitcoin.org";

async function waitMintPaid(w: Wallet, quote: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const st = await w.checkMintQuoteBolt11(quote);
    if (String(st.state) !== "UNPAID") return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Pont : paiement non confirmé par le mint pont");
}

async function bridgeToArk(src: Wallet, proofs: any[], totalSats: number, privkey: string, tag: string): Promise<number> {
  const key = `bridge.pending.${tag}`;
  const bWallet = new Wallet(new Mint(BRIDGE_MINT_URL, { customRequest: cashuFetch }));
  await bWallet.loadMint();
  // Saut 1 : le mint source paie une facture du mint pont
  const probe = await src.createMeltQuoteBolt11((await bWallet.createMintQuoteBolt11(totalSats)).request);
  const a1 = totalSats - Number(probe.fee_reserve ?? 0) - 1;
  if (a1 <= 0) throw new Error("Pont : montant trop faible");
  const mq = await bWallet.createMintQuoteBolt11(a1);
  const mlt1 = await src.createMeltQuoteBolt11(mq.request);
  mmkv.set(key, JSON.stringify({ step: "quote", mint: BRIDGE_MINT_URL, quote: mq.quote, amount: a1 }));
  try { await src.meltProofsBolt11(mlt1, proofs, { privkey }); }
  catch (e: any) { mmkv.set(key, ""); throw new Error("Pont saut 1 : " + (e?.message ?? String(e))); }
  await waitMintPaid(bWallet, mq.quote);
  const bProofs = await bWallet.mintProofsBolt11(a1, mq.quote);
  mmkv.set(key, JSON.stringify({ step: "token", token: getEncodedToken({ mint: BRIDGE_MINT_URL, proofs: bProofs }) }));
  // Saut 2 : le mint pont paie la facture Ark
  const inFee = Number(bWallet.getFeesForProofs(bProofs));
  const p2 = await bolt11Invoice(a1 - inFee);
  if (p2.isErr()) throw new Error("Pont : facture Ark (sonde) impossible");
  const q0 = await bWallet.createMeltQuoteBolt11(p2.value.payment_request);
  const a2 = a1 - inFee - Number(q0.fee_reserve ?? 0) - 1;
  const inv = await bolt11Invoice(a2);
  if (inv.isErr()) throw new Error("Pont : facture Ark impossible");
  const q = await bWallet.createMeltQuoteBolt11(inv.value.payment_request);
  try { await bWallet.meltProofsBolt11(q, bProofs); }
  catch (e: any) { throw new Error("Pont saut 2 (ecash Cuba sauvegardé) : " + (e?.message ?? String(e))); }
  mmkv.set(key, "");
  return a2;
}
