import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import QRCode from "react-native-qrcode-svg";
import Share from "react-native-share";
import Icon from "@react-native-vector-icons/ionicons";
import { NoahSafeAreaView } from "~/components/NoahSafeAreaView";
import { COLORS } from "~/lib/styleConstants";
import { t } from "~/lib/i18n";
import {
  getMarketData, takerClaimOffer, takerSubmitReceipt, redeemTakerRewardIfAny,
  takerPubKey, offerBondSats, offerRewardSats, getTakerClaims,
} from "~/lib/openpleb";

const ACTIVE = ["CLAIMED", "RECEIPT_SUBMITTED", "MARKED_WITH_ISSUE"];
const secondsLeft = (o: any, now: number) =>
  Math.max(0, Number(o.createdAt) + Number(o.validForS) - Math.floor(now / 1000));
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function EarnScreen() {
  const navigation = useNavigation<any>();
  const [offers, setOffers] = useState<any[]>([]);
  const [active, setActive] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reward, setReward] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const trackedRef = useRef<number | null>(null);
  const qrRef = useRef<any>(null);
  const refreshingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const me = takerPubKey();
      const { offers: all, claims } = await getMarketData();
      const mine = new Set(claims.filter((c: any) => c.pubkey === me).map((c: any) => c.offerId));
      const act = all.find((o: any) => mine.has(o.id) && ACTIVE.includes(o.status)) ?? null;
      if (act) trackedRef.current = act.id;
      setActive(act);
      setOffers(all.filter((o: any) => o.status === "INVOICE_PAID"));
      // Offre suivie qui vient de se terminer : on encaisse la récompense
      if (!act && trackedRef.current != null) {
        const id = trackedRef.current;
        const sats = await redeemTakerRewardIfAny(id);
        if (sats > 0) { setReward(sats); trackedRef.current = null; }
        else if (!getTakerClaims().includes(id)) trackedRef.current = null;
      }
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const pend = getTakerClaims();
    if (pend.length) trackedRef.current = pend[pend.length - 1];
    refresh();
    const poll = setInterval(refresh, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [refresh]);

  const claim = (o: any) => {
    Alert.alert(t("earn.confirmTitle"), t("earn.confirmBody", { thb: o.amount, bond: offerBondSats(o) }), [
      { text: t("earn.cancel"), style: "cancel" },
      {
        text: t("earn.take"),
        onPress: async () => {
          setBusy(t("earn.claiming")); setError(null);
          try { await takerClaimOffer(o); trackedRef.current = o.id; await refresh(); }
          catch (e: any) { setError(e?.message ?? String(e)); }
          finally { setBusy(null); }
        },
      },
    ]);
  };

  // Export du QR en image : partage vers l'app bancaire ou enregistrement dans la galerie
  const shareQr = () => {
    if (!qrRef.current) return;
    qrRef.current.toDataURL(async (data: string) => {
      try {
        await Share.open({ url: `data:image/png;base64,${data}`, type: "image/png", filename: `thark-qr-${active?.id ?? "offre"}`, failOnCancel: false });
      } catch (err: any) {
        setError(err?.message ?? String(err));
      }
    });
  };

  const sendReceipt = async () => {
    if (!active) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.5, base64: true });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    const a = res.assets[0];
    setBusy(t("earn.sendingReceipt")); setError(null);
    try { await takerSubmitReceipt(active.id, `data:${a.mimeType ?? "image/jpeg"};base64,${a.base64}`); await refresh(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(null); }
  };

  return (
    <NoahSafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <View className="flex-row items-center mb-4">
          <Pressable onPress={() => navigation.goBack()} className="mr-4">
            <Icon name="arrow-back-outline" size={24} color={COLORS.BITCOIN_ORANGE} />
          </Pressable>
          <Text className="text-2xl font-bold text-foreground">{t("earn.title")}</Text>
        </View>

        {reward != null ? (
          <View className="mb-6 rounded-3xl p-6 items-center" style={{ backgroundColor: "#16a34a22", borderWidth: 1, borderColor: "#16a34a" }}>
            <Icon name="checkmark-circle" size={72} color="#16a34a" />
            <Text className="text-2xl font-bold text-foreground mt-3 text-center">{t("earn.rewardTitle")}</Text>
            <Text className="text-base text-muted-foreground mt-2 text-center">{t("earn.rewardBody", { n: reward })}</Text>
            <Pressable onPress={() => setReward(null)} className="mt-4">
              <Text style={{ color: COLORS.BITCOIN_ORANGE }}>{t("earn.ok")}</Text>
            </Pressable>
          </View>
        ) : null}

        {busy ? (
          <View className="mb-4 rounded-2xl p-4 flex-row items-center" style={{ backgroundColor: "#F7931A20", borderWidth: 1, borderColor: COLORS.BITCOIN_ORANGE }}>
            <ActivityIndicator color={COLORS.BITCOIN_ORANGE} />
            <Text className="ml-3 flex-1 text-foreground">{busy}</Text>
          </View>
        ) : null}
        {error ? (
          <View className="mb-4 rounded-xl bg-card p-4">
            <Text className="text-foreground text-sm">❌ {error}</Text>
          </View>
        ) : null}

        {active ? (
          <View className="rounded-2xl bg-card p-5 items-center">
            <Text className="text-sm text-muted-foreground">{t("earn.payTo")}</Text>
            <Text className="text-4xl font-bold mt-1" style={{ color: COLORS.BITCOIN_ORANGE }}>฿ {active.amount}</Text>
            <Text className="text-sm text-muted-foreground mt-1">{t("earn.timeLeft", { t: fmt(secondsLeft(active, now)) })}</Text>
            {active.status === "CLAIMED" ? (
              <>
                <View className="mt-4 p-3 rounded-xl" style={{ backgroundColor: "#ffffff" }}>
                  <QRCode value={active.qrCode} size={240} quietZone={16} backgroundColor="#ffffff" getRef={(c: any) => (qrRef.current = c)} />
                </View>
                <Text className="text-sm text-muted-foreground mt-4 text-center">{t("earn.payHelp")}</Text>
                <Pressable
                  onPress={shareQr}
                  className="h-12 w-full rounded-2xl items-center justify-center mt-4 border flex-row"
                  style={{ borderColor: COLORS.BITCOIN_ORANGE }}
                >
                  <Icon name="share-social-outline" size={20} color={COLORS.BITCOIN_ORANGE} />
                  <Text className="ml-2 font-semibold" style={{ color: COLORS.BITCOIN_ORANGE }}>{t("earn.shareQr")}</Text>
                </Pressable>
                <Pressable
                  onPress={sendReceipt}
                  disabled={!!busy}
                  className="h-14 w-full rounded-2xl items-center justify-center mt-4"
                  style={{ backgroundColor: COLORS.BITCOIN_ORANGE, opacity: busy ? 0.5 : 1 }}
                >
                  <Text className="font-bold" style={{ color: "#1a1a1a" }}>{t("earn.sendReceipt")}</Text>
                </Pressable>
              </>
            ) : active.status === "RECEIPT_SUBMITTED" ? (
              <Text className="text-base text-foreground mt-4 text-center">{t("earn.waitingMaker")}</Text>
            ) : (
              <Text className="text-base text-foreground mt-4 text-center">{t("earn.disputed")}</Text>
            )}
          </View>
        ) : (
          <>
            <Text className="text-sm text-muted-foreground mb-4">{t("earn.intro")}</Text>
            {loading ? (
              <ActivityIndicator color={COLORS.BITCOIN_ORANGE} />
            ) : offers.length === 0 ? (
              <Text className="text-base text-muted-foreground text-center mt-8">{t("earn.none")}</Text>
            ) : (
              offers.map((o) => (
                <View key={o.id} className="rounded-2xl bg-card p-4 mb-3">
                  <View className="flex-row justify-between items-center">
                    <Text className="text-2xl font-bold text-foreground">฿ {o.amount}</Text>
                    <Text className="text-sm text-muted-foreground">{fmt(secondsLeft(o, now))}</Text>
                  </View>
                  <Text className="text-sm mt-1" style={{ color: "#16a34a" }}>{t("earn.gain", { n: offerRewardSats(o) })}</Text>
                  <Text className="text-xs text-muted-foreground mt-1">{t("earn.bond", { n: offerBondSats(o) })}</Text>
                  <Pressable
                    onPress={() => claim(o)}
                    disabled={!!busy}
                    className="h-12 rounded-2xl items-center justify-center mt-3"
                    style={{ backgroundColor: COLORS.BITCOIN_ORANGE, opacity: busy ? 0.5 : 1 }}
                  >
                    <Text className="font-bold" style={{ color: "#1a1a1a" }}>{t("earn.take")}</Text>
                  </Pressable>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </NoahSafeAreaView>
  );
}
