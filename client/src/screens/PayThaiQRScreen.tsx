import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, TextInput,
} from "react-native";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { NoahSafeAreaView } from "~/components/NoahSafeAreaView";
import { COLORS } from "~/lib/styleConstants";
import Icon from "@react-native-vector-icons/ionicons";
import { parsePromptPay } from "~/lib/promptpay";
import { t } from "~/lib/i18n";
import {
  createOffer, getOfferInvoice, payOfferInvoice, checkInvoicePaid, redeemOfferRefundIfAny, addPendingOffer, removePendingOffer, type OpenPlebOffer,
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
      setStatus("Finalisation...");
      // Notifier le backend que la facture est payée (récupère l'ecash, passe l'offre à INVOICE_PAID)
      await checkInvoicePaid(offer.id);
      addPendingOffer(offer.id);
      setWaiting(true);
      setStatus(t("pay.paidWaiting"));
      // Si aucun taker ne prend l'offre, elle expire et le montant est
      // remboursé automatiquement dans le wallet.
      const offerId = offer.id;
      setTimeout(async () => {
        try {
          const sats = await redeemOfferRefundIfAny(offerId);
          if (sats > 0) {
            removePendingOffer(offerId);
            setStatus(t("pay.refunded", { n: sats }));
          } else {
            setStatus(t("pay.processing"));
          }
        } catch {
          setStatus(t("pay.refundPending"));
        } finally {
          setWaiting(false);
        }
      }, 130000);
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
            Ce QR n'est pas un QR PromptPay valide.
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
            disabled={busy}
            className="h-14 rounded-2xl items-center justify-center mt-2"
            style={{ backgroundColor: COLORS.BITCOIN_ORANGE }}
          >
            {busy ? (
              <ActivityIndicator color="#1a1a1a" />
            ) : (
              <Text className="font-bold" style={{ color: "#1a1a1a" }}>
                {t("pay.confirmPay")}
              </Text>
            )}
          </Pressable>
        )}

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

        {status ? (
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
