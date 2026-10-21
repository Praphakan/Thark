import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, TextInput, Image,
} from "react-native";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { NoahSafeAreaView } from "~/components/NoahSafeAreaView";
import { COLORS } from "~/lib/styleConstants";
import Icon from "@react-native-vector-icons/ionicons";
import { parsePromptPay } from "~/lib/promptpay";
import { t } from "~/lib/i18n";
import {
  createOffer, getOfferInvoice, payOfferInvoice, checkInvoicePaid, redeemOfferRefundIfAny, addPendingOffer, removePendingOffer, getOffer, getOfferReceipt, sendMakerFeedback, type OpenPlebOffer,
} from "~/lib/openpleb";
import type { HomeStackParamList } from "~/Navigators";

type Nav = NativeStackNavigationProp<HomeStackParamList>;
type ScreenRoute = RouteProp<HomeStackParamList, "PayThaiQR">;

export default function PayThaiQRScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ScreenRoute>();
  const qrData = route.params?.qrData ?? "";

  const parsed = parsePromptPay(qrData);
  const [amount, setAmount] = useState<string>(
    parsed?.amountThb ? String(parsed.amountThb) : "",
  );
  const [offer, setOffer] = useState<OpenPlebOffer | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [paid, setPaid] = useState(false);
  const [result, setResult] = useState<null | { kind: "success" | "refund"; sats: number }>(null);
  const [trackedOfferId, setTrackedOfferId] = useState<number | null>(null);
  const [receiptImg, setReceiptImg] = useState<string | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const hadReceiptRef = useRef(false);

  // Suivi en direct de l'offre jusqu'à sa résolution
  const watchOffer = async (offerId: number) => {
    setTrackedOfferId(offerId);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 450; i++) {
      let o: any = null;
      try { o = await getOffer(offerId); } catch { await sleep(4000); continue; }
      if (o?.refund) {
        try {
          const sats = await redeemOfferRefundIfAny(offerId);
          if (sats > 0) {
            removePendingOffer(offerId);
            setResult({ kind: hadReceiptRef.current ? "success" : "refund", sats });
            setStatus(hadReceiptRef.current ? t("pay.completedBond", { n: sats }) : t("pay.refunded", { n: sats }));
          }
        } catch { setStatus(t("pay.refundPending")); }
        setReceiptImg(null); setWaiting(false); return;
      }
      if (o?.status === "INVOICE_PAID") setStatus(t("pay.waitTaker"));
      else if (o?.status === "CLAIMED") setStatus(t("pay.takerPaying"));
      else if (o?.status === "MARKED_WITH_ISSUE") setStatus(t("pay.disputed"));
      else if (o?.status === "RECEIPT_SUBMITTED" && !hadReceiptRef.current) {
        try {
          const img = await getOfferReceipt(offerId);
          if (img) { hadReceiptRef.current = true; setReceiptImg(img); setStatus(t("pay.receiptReceived")); }
        } catch {}
      }
      await sleep(4000);
    }
    setWaiting(false);
  };

  const handleFeedback = async (decision: "COMPLETED" | "MARKED_WITH_ISSUE") => {
    if (trackedOfferId == null) return;
    setFeedbackBusy(true);
    try {
      await sendMakerFeedback(trackedOfferId, decision, decision === "MARKED_WITH_ISSUE" ? "Paiement non reçu par le commerçant" : "");
      setReceiptImg(null);
      setStatus(decision === "COMPLETED" ? t("pay.confirmedWaitingBond") : t("pay.disputed"));
    } catch (e: any) {
      setStatus(`❌ ${e?.message ?? String(e)}`);
    } finally {
      setFeedbackBusy(false);
    }
  };

  const amountThb = parseFloat(amount) || 0;

  // Détail des coûts (une fois l'offre créée)
  const costs = offer
    ? {
        base: offer.satsAmount,
        fees:
          (offer as any).platformFeeFlatRate +
          (offer as any).platformFeePercentage +
          (offer as any).takerFeeFlatRate +
          (offer as any).takerFeePercentage,
        bond:
          (offer as any).bondFlatRate + (offer as any).bondPercentage,
      }
    : null;
  const total = costs ? costs.base + costs.fees + costs.bond : null;
  const totalThb =
    costs && total && costs.base > 0
      ? (amountThb * total) / costs.base
      : null;
  // Contre-valeur baht proportionnelle de chaque poste
  const thbOf = (sats: number) =>
    costs && costs.base > 0 ? (amountThb * sats) / costs.base : 0;

  // Reprise du suivi d'une transaction depuis la bannière de l'accueil
  const resumeRoute = useRoute<any>();
  useEffect(() => {
    const id = resumeRoute.params?.resumeOfferId;
    if (!id) return;
    (async () => {
      try { setOffer(await getOffer(id)); } catch {}
      setPaid(true); setWaiting(true); void watchOffer(id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Étape 1 : créer l'offre pour obtenir le détail des coûts
  const handleCreateOffer = async () => {
    if (amountThb <= 0) {
      setStatus(t("pay.invalidAmount"));
      return;
    }
    if (amountThb < 50 || amountThb > 5000) {
      setStatus(t("pay.amountRange"));
      return;
    }
    setBusy(true);
    setStatus(t("pay.calculatingFees"));
    try {
      const o = await createOffer({ qrCode: qrData, amountThb });
      setOffer(o);
      setStatus("");
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.includes("minimum") || msg.includes("maximum")) {
        setStatus(t("pay.amountRange"));
      } else {
        setStatus(`❌ ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  };

  // Étape 2 : payer la facture
  const handleConfirmPay = async () => {
    if (!offer) return;
    setBusy(true);
    setStatus(t("pay.gettingInvoice"));
    try {
      const invoice = await getOfferInvoice(offer.id);
      setStatus(t("pay.paying"));
      await payOfferInvoice(invoice);
      setPaid(true);
      setStatus("Finalisation...");
      // Notifier le backend que la facture est payée (récupère l'ecash, passe l'offre à INVOICE_PAID)
      await checkInvoicePaid(offer.id);
      addPendingOffer(offer.id);
      setWaiting(true);
      setStatus(t("pay.paidWaiting"));
      // Si aucun taker ne prend l'offre, elle expire et le montant est
      // remboursé automatiquement dans le wallet.
      void watchOffer(offer.id);
    } catch (e: any) {
      setStatus(`❌ ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!parsed) {
    return (
      <NoahSafeAreaView className="flex-1 bg-background">
        <View className="flex-row items-center px-5 pt-4 pb-3">
          <Pressable onPress={() => navigation.goBack()} className="mr-4">
            <Icon name="arrow-back-outline" size={24} color={COLORS.BITCOIN_ORANGE} />
          </Pressable>
          <Text className="text-2xl font-bold text-foreground">QR Thaï</Text>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-muted-foreground">
            {t("ui.070")}
          </Text>
        </View>
      </NoahSafeAreaView>
    );
  }

  return (
    <NoahSafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <View className="flex-row items-center mb-6">
          <Pressable onPress={() => navigation.goBack()} className="mr-4">
            <Icon name="arrow-back-outline" size={24} color={COLORS.BITCOIN_ORANGE} />
          </Pressable>
          <Text className="text-2xl font-bold text-foreground">{t("pay.title")}</Text>
        </View>

        {parsed.merchantName ? (
          <View className="mb-4 rounded-2xl bg-card p-4">
            <Text className="text-sm text-muted-foreground">{t("pay.merchant")}</Text>
            <Text className="text-lg font-semibold text-foreground mt-1">
              {parsed.merchantName}
            </Text>
          </View>
        ) : null}

        <View className="mb-4 rounded-2xl bg-card p-4">
          <Text className="text-sm text-muted-foreground mb-2">{t("pay.amountThb")}</Text>
          {parsed.amountThb ? (
            <Text className="text-3xl font-bold" style={{ color: COLORS.BITCOIN_ORANGE }}>
              ฿ {parsed.amountThb}
            </Text>
          ) : (
            <TextInput
              value={amount}
              onChangeText={(v) => { setAmount(v); setOffer(null); }}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#888"
              editable={!offer}
              className="text-3xl font-bold"
              style={{ color: COLORS.BITCOIN_ORANGE }}
            />
          )}
        </View>

        {/* Récap détaillé une fois l'offre créée */}
        {costs && total ? (
          <View className="mb-4 rounded-2xl bg-card p-4">
            <Text className="text-sm text-muted-foreground mb-3">{t("pay.detail")}</Text>
            <View className="flex-row justify-between mb-2">
              <Text className="text-foreground">{t("pay.amount")}</Text>
              <View className="items-end">
                <Text className="text-foreground">฿ {amountThb}</Text>
                <Text className="text-xs text-muted-foreground">{costs.base.toLocaleString()} sats</Text>
              </View>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-muted-foreground">{t("pay.serviceFee")}</Text>
              <View className="items-end">
                <Text className="text-muted-foreground">฿ {thbOf(costs.fees).toFixed(2)}</Text>
                <Text className="text-xs text-muted-foreground">{costs.fees.toLocaleString()} sats</Text>
              </View>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-muted-foreground">{t("pay.bond")}</Text>
              <View className="items-end">
                <Text className="text-muted-foreground">฿ {thbOf(costs.bond).toFixed(2)}</Text>
                <Text className="text-xs text-muted-foreground">{costs.bond.toLocaleString()} sats</Text>
              </View>
            </View>
            <View className="h-px bg-border my-2" />
            <View className="flex-row justify-between">
              <Text className="text-foreground font-bold">{t("pay.total")}</Text>
              <View className="items-end">
                <Text className="font-bold" style={{ color: COLORS.BITCOIN_ORANGE }}>{totalThb ? `฿ ${totalThb.toFixed(2)}` : ""}</Text>
                <Text className="text-xs" style={{ color: COLORS.BITCOIN_ORANGE }}>{total.toLocaleString()} sats</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Bouton : créer l'offre OU confirmer le paiement */}
        {!offer ? (
          <Pressable
            onPress={handleCreateOffer}
            disabled={busy}
            className="h-14 rounded-2xl items-center justify-center mt-2"
            style={{ backgroundColor: COLORS.BITCOIN_ORANGE }}
          >
            {busy ? (
              <ActivityIndicator color="#1a1a1a" />
            ) : (
              <Text className="font-bold" style={{ color: "#1a1a1a" }}>
                {t("pay.continue")}
              </Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={handleConfirmPay}
            disabled={busy || paid}
            className="h-14 rounded-2xl items-center justify-center mt-2"
            style={{ backgroundColor: paid ? "#9ca3af" : COLORS.BITCOIN_ORANGE, opacity: paid ? 0.7 : 1 }}
          >
            {busy ? (
              <ActivityIndicator color="#1a1a1a" />
            ) : (
              <Text className="font-bold" style={{ color: "#1a1a1a" }}>
                {paid ? t("pay.paidLabel") : t("pay.confirmPay")}
              </Text>
            )}
          </Pressable>
        )}

        {result ? (
          <View
            className="mt-6 rounded-3xl p-6 items-center"
            style={{
              backgroundColor: result.kind === "success" ? "#16a34a22" : "#F7931A22",
              borderWidth: 1,
              borderColor: result.kind === "success" ? "#16a34a" : COLORS.BITCOIN_ORANGE,
            }}
          >
            <Icon
              name={result.kind === "success" ? "checkmark-circle" : "arrow-undo-circle"}
              size={72}
              color={result.kind === "success" ? "#16a34a" : COLORS.BITCOIN_ORANGE}
            />
            <Text className="text-2xl font-bold text-foreground mt-3 text-center">
              {result.kind === "success" ? t("pay.successTitle") : t("pay.refundTitle")}
            </Text>
            <Text className="text-base text-muted-foreground mt-2 text-center">
              {result.kind === "success" ? t("pay.successBody", { n: result.sats }) : t("pay.refundBody", { n: result.sats })}
            </Text>
          </View>
        ) : null}

        {receiptImg ? (
          <View className="mt-6 rounded-2xl bg-card p-4">
            <Text className="text-foreground font-bold mb-2">{t("pay.receiptTitle")}</Text>
            <Image source={{ uri: receiptImg }} style={{ width: "100%", height: 320 }} resizeMode="contain" />
            <Text className="text-sm text-muted-foreground mt-3">{t("pay.verifyWithMerchant")}</Text>
            <Pressable
              onPress={() => handleFeedback("COMPLETED")}
              disabled={feedbackBusy}
              className="h-12 rounded-2xl items-center justify-center mt-4"
              style={{ backgroundColor: COLORS.BITCOIN_ORANGE, opacity: feedbackBusy ? 0.5 : 1 }}
            >
              <Text className="font-bold" style={{ color: "#1a1a1a" }}>{t("pay.confirmReceived")}</Text>
            </Pressable>
            <Pressable
              onPress={() => handleFeedback("MARKED_WITH_ISSUE")}
              disabled={feedbackBusy}
              className="h-12 rounded-2xl items-center justify-center mt-3 border"
              style={{ borderColor: "#888" }}
            >
              <Text className="text-foreground">{t("pay.reportIssue")}</Text>
            </Pressable>
          </View>
        ) : null}

        {waiting ? (
          <View
            className="mt-6 rounded-2xl p-4 flex-row items-center"
            style={{ backgroundColor: "#F7931A20", borderWidth: 1, borderColor: COLORS.BITCOIN_ORANGE }}
          >
            <ActivityIndicator color={COLORS.BITCOIN_ORANGE} />
            <Text className="ml-3 flex-1 text-foreground text-sm">
{t("pay.doNotClose")}
            </Text>
          </View>
        ) : null}

        {status && !result ? (
          <View className="mt-6 rounded-xl bg-card p-4">
            <Text className="text-foreground text-sm" style={{ fontFamily: "monospace" }}>
              {status}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </NoahSafeAreaView>
  );
}
