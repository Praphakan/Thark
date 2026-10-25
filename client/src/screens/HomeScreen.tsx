import { useGetExpiringVtxos as useExpiringForBanner, useRefreshExpiringVtxos as useRefreshForBanner } from "~/hooks/useWallet";
import * as Notifications from "expo-notifications";
let lastHandledNotifId: string | null = null;
import { View, ScrollView, RefreshControl, Pressable } from "react-native";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HomeStackParamList, TabParamList } from "../Navigators";
import { Text } from "../components/ui/text";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { AlertCircle, ChevronDown, Eye, EyeOff, PauseCircle } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { COLORS } from "../lib/styleConstants";
import { useIconColor } from "../hooks/useTheme";
import { NoahActivityIndicator } from "../components/ui/NoahActivityIndicator";
import { useBalance, useLoadWallet, useWalletSync } from "../hooks/useWallet";
import Icon from "@react-native-vector-icons/ionicons";
import { APP_VARIANT } from "~/config";
import { t } from "~/lib/i18n";
import { useIsFocused } from "@react-navigation/native";
import { isTakerModeEnabled, getPendingOffers, getOffer } from "~/lib/openpleb";
import { PLATFORM } from "~/constants";
import { useAppVersionCheck } from "~/hooks/useAppVersionCheck";
import { UpdateWarningBanner } from "~/components/UpdateWarningBanner";
import { EmailVerificationBanner } from "~/components/EmailVerificationBanner";
import { BackupStatusBanner } from "~/components/BackupStatusBanner";
import { AutoBoardingStatusBanner } from "~/components/AutoBoardingStatusBanner";
import { PendingRoundStatusBanner } from "~/components/PendingRoundStatusBanner";
import { useBackgroundJobCoordination } from "~/hooks/useBackgroundJobCoordination";
import { useServerStore } from "~/store/serverStore";
import { queryClient } from "~/queryClient";

import Animated, {
  FadeInDown,
  FadeOutDown,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { NoahSafeAreaView } from "~/components/NoahSafeAreaView";
import { useBottomTabBarHeight } from "react-native-bottom-tabs";
import { useBtcToFiatRate } from "~/hooks/useMarketData";
import { useWalletStore } from "~/store/walletStore";
import { updateWidget, useWidget } from "~/hooks/useWidget";
import { formatFiatAmount, getFiatCurrencyInfo, satsToFiat } from "~/lib/fiatCurrency";
import { calculateBalances } from "~/lib/balanceUtils";
import { onchainSync, sync } from "~/lib/walletApi";
import { useTransactions } from "~/hooks/useTransactions";
import { Transaction } from "~/types/transaction";
import { AppBottomSheet } from "~/components/ui/AppBottomSheet";
import { TransactionDetailContent } from "~/screens/TransactionDetailScreen";
import { usePrivacyStore } from "~/store/privacyStore";
import { useProfileStore } from "~/store/profileStore";
import { useBitcoinAmountFormatter } from "~/hooks/useBitcoinAmountFormatter";

const getTransactionIcon = (type: Transaction["type"]) => {
  switch (type) {
    case "Bolt11":
    case "Lnurl":
      return "flash-outline";
    case "Arkoor":
      return "boat-outline";
    case "Onchain":
      return "cube-outline";
    default:
      return "cash-outline";
  }
};

const getTransactionLabel = (transaction: Transaction) => {
  if (transaction.type === "Bolt11" || transaction.type === "Lnurl") {
    return "Lightning";
  }

  if (transaction.type === "Arkoor") {
    return "Ark";
  }

  return transaction.type;
};

const HomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  useIsFocused(); // relit le réglage au retour sur l'accueil
  const takerMode = isTakerModeEnabled();
  const expiringForBanner = useExpiringForBanner();
  const refreshForBanner = useRefreshForBanner();
  const vtxosToRefresh = ((expiringForBanner.data as any[]) ?? []).filter((v) => String(v.state) === "Spendable").length;
  // Toucher une alerte "Nouvelle offre" ouvre l'écran Gagner des sats
  const lastNotif = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const req: any = lastNotif?.notification?.request;
    if (!req) return;
    const screen = req.content?.data?.screen ?? req.trigger?.remoteMessage?.data?.screen;
    if (screen === "Earn" && lastHandledNotifId !== req.identifier) {
      lastHandledNotifId = req.identifier;
      navigation.navigate("Earn");
    }
  }, [lastNotif]);
  const iconColor = useIconColor();
  const formatBitcoinAmount = useBitcoinAmountFormatter();
  const parentNavigation = navigation.getParent<NavigationProp<TabParamList>>();
  const { walletError, isWalletSuspended } = useWalletStore();
  const { safelyExecuteWhenReady, isBackgroundJobRunning } = useBackgroundJobCoordination();
  const { data: balance, refetch, error, isLoading: isBalanceLoading } = useBalance();
  const { isPending: isSyncPending } = useWalletSync();
  const { mutateAsync: loadWallet } = useLoadWallet();
  const fiatCurrency = useProfileStore((state) => state.preferredCurrency);
  const fiatCurrencyInfo = getFiatCurrencyInfo(fiatCurrency);
  const { data: btcToFiatRate, isLoading: isRateLoading } = useBtcToFiatRate();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isTransactionSheetOpen, setIsTransactionSheetOpen] = useState(false);
  const bottomTabBarHeight = useBottomTabBarHeight();
  const { isUpdateRequired, minimumVersion, currentVersion } = useAppVersionCheck();
  const { isEmailVerified, isEmailPromptDismissed, setEmailPromptDismissed } = useServerStore();
  const { data: transactions = [], isLoading: isTransactionsLoading } = useTransactions();
  const isHomeBalanceHidden = usePrivacyStore((state) => state.isHomeBalanceHidden);
  const toggleHomeBalanceHidden = usePrivacyStore((state) => state.toggleHomeBalanceHidden);
  const recentTransactions = transactions.slice(0, 3);

  const handleEmailVerificationPress = useCallback(() => {
    navigation.navigate("EmailVerification", { fromSettings: true });
  }, [navigation]);

  const getRandomFact = useCallback(() => {
  }, []);

  useEffect(() => {
    safelyExecuteWhenReady(() => loadWallet());
    getRandomFact();
  }, [getRandomFact, safelyExecuteWhenReady, loadWallet]);

  const onRefresh = useCallback(async () => {
    await safelyExecuteWhenReady(() => loadWallet());

    await sync();
    await onchainSync();
    await queryClient.invalidateQueries({ queryKey: ["pending-rounds"] });
    await refetch();
    await updateWidget();
    getRandomFact();
  }, [refetch, getRandomFact, safelyExecuteWhenReady, loadWallet]);

  const openHistory = () => {
    parentNavigation?.navigate("History", { screen: "TransactionsList" });
  };

  const openTransaction = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setIsTransactionSheetOpen(true);
  };

  const isLoading = isBalanceLoading || isSyncPending || isRateLoading;
  const balances = balance ? calculateBalances(balance) : null;
  const totalBalance = balances?.totalBalance ?? 0;
  const onchainBalance = balances?.onchainBalance ?? 0;
  const offchainBalance = balances?.offchainBalance ?? 0;
  const totalPendingBalance = balances?.pendingBalance ?? 0;
  const totalBalanceInFiat = btcToFiatRate
    ? satsToFiat(totalBalance, btcToFiatRate, fiatCurrency)
    : null;
  const errorMessage = error instanceof Error ? error.message : String(error);
  const maskedBalance = "••••";
  const formatHomeBalance = (amount: number) =>
    isHomeBalanceHidden ? maskedBalance : formatBitcoinAmount(amount);

  useWidget(balances);

  const animatedRotation = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: withTiming(isOpen ? "180deg" : "0deg") }],
    };
  }, [isOpen]);

  if (isWalletSuspended) {
    return (
      <NoahSafeAreaView
        className="flex-1 bg-background"
        style={{
          paddingBottom: PLATFORM === "ios" ? bottomTabBarHeight : 0,
        }}
      >
        <View className="flex-1 items-center justify-center p-8">
          <View className="bg-card rounded-2xl p-8 items-center max-w-[320px] border border-border">
            <View className="w-20 h-20 rounded-full bg-destructive/10 items-center justify-center mb-6">
              <PauseCircle size={48} color="#dc2626" />
            </View>
            <Text className="text-2xl font-bold text-foreground mb-3 text-center">
              {t("ui.061")}
            </Text>
            <Text className="text-base text-muted-foreground text-center leading-6">
              {t("ui.062")}
            </Text>
            <Text className="text-sm text-muted-foreground text-center mt-4">
              {t("ui.063")}
            </Text>
            <Pressable
              onPress={() => navigation.navigate("Settings")}
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              className="mt-6 rounded-2xl bg-primary px-5 py-3"
            >
              <Text className="font-semibold text-primary-foreground">Open Settings</Text>
            </Pressable>
          </View>
        </View>
      </NoahSafeAreaView>
    );
  }

  return (
    <NoahSafeAreaView
      className="flex-1 bg-background"
      style={{
        paddingBottom: PLATFORM === "ios" ? bottomTabBarHeight : 0,
      }}
    >
      <View className="flex-row items-center justify-between p-4">
        <Pressable onPress={() => navigation.navigate("BoardArk")}>
          <Text className="text-3xl font-bold text-foreground">
            Th<Text className="text-3xl font-bold" style={{ color: COLORS.BITCOIN_ORANGE }}>â</Text>rk
          </Text>
        </Pressable>
        <View className="flex-1 items-center">
          {APP_VARIANT !== "mainnet" && (
            <View className="rounded-full bg-card px-2.5 py-1">
              <Text className="text-xs font-medium uppercase text-muted-foreground">{APP_VARIANT}</Text>
            </View>
          )}
        </View>
        <View className="flex-row items-center gap-4">
          <Pressable
            onPress={() => navigation.navigate("Settings")}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
          >
            <Icon name="settings-outline" size={26} color={iconColor} />
          </Pressable>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isSyncPending}
            onRefresh={onRefresh}
            tintColor={COLORS.BITCOIN_ORANGE}
            colors={[COLORS.BITCOIN_ORANGE]}
            title="Refreshing..."
            titleColor={COLORS.BITCOIN_ORANGE}
            progressViewOffset={-10}
          />
        }
      >
        {/* UpdateWarningBanner retiré (Thârk) */}
        {/* EmailVerificationBanner retiré (Thârk) */}
        <BackupStatusBanner />
        <PendingRoundStatusBanner />
        <AutoBoardingStatusBanner />
        {isBackgroundJobRunning && (
          <View className="px-4 py-2 bg-blue-500/20 border-b border-blue-500/40">
            <View className="flex-row items-center justify-center space-x-2">
              <NoahActivityIndicator size="small" />
              <Text className="text-blue-400 text-sm">Background task in progress...</Text>
            </View>
          </View>
        )}
        <View className="px-5 pt-16 pb-10">
          {isLoading && !balance ? (
            <View className="items-center justify-center py-28">
              <NoahActivityIndicator size="large" />
            </View>
          ) : (error || walletError) && !balance ? (
            <Alert variant="destructive" icon={AlertCircle}>
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                {walletError
                  ? t("ui.064")
                  : errorMessage}
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <View className="items-center pb-10">
                <View className="items-center">
                  {isHomeBalanceHidden ? (
                    <Text className="mb-2 text-2xl text-muted-foreground">
                      {fiatCurrencyInfo.symbol} {maskedBalance}
                    </Text>
                  ) : totalBalanceInFiat ? (
                    <Text className="mb-2 text-2xl text-muted-foreground">
                      {formatFiatAmount(totalBalanceInFiat, fiatCurrency)}
                    </Text>
                  ) : (
                    <View className="h-[32px] mb-2 justify-center">
                      <NoahActivityIndicator />
                    </View>
                  )}
                  <View className="flex-row items-center justify-center px-4">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("ui.065")}
                      accessibilityState={{ expanded: isOpen }}
                      onPress={() => setIsOpen((current) => !current)}
                      style={{ flexShrink: 1 }}
                    >
                      <View className="flex-row items-center space-x-2">
                        <Text
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          className="text-6xl font-semibold tracking-tight"
                          style={{ flexShrink: 1 }}
                        >
                          {formatHomeBalance(totalBalance)}
                        </Text>
                        <Animated.View style={animatedRotation}>
                          <ChevronDown color={iconColor} size={28} />
                        </Animated.View>
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={toggleHomeBalanceHidden}
                      accessibilityRole="button"
                      accessibilityLabel={
                        isHomeBalanceHidden ? t("ui.066") : t("ui.067")
                      }
                      hitSlop={12}
                      className="ml-3 h-8 w-8 items-center justify-center"
                    >
                      {isHomeBalanceHidden ? (
                        <Eye color={iconColor} size={18} />
                      ) : (
                        <EyeOff color={iconColor} size={18} />
                      )}
                    </Pressable>
                  </View>
                  {totalPendingBalance > 0 && (
                    <View className="mt-2 px-3 py-1 rounded-full bg-yellow-500/20 border border-yellow-500/40">
                      <Text className="text-yellow-500 text-sm">
                        Pending balance: {formatHomeBalance(totalPendingBalance)}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Boutons d'action Thârk */}
                <View className="flex-row justify-center gap-3 mt-8 px-1">
                  <Pressable
                    className="flex-1 items-center py-5 rounded-2xl bg-card"
                    onPress={() => navigation.navigate("Receive")}
                    accessibilityRole="button"
                    accessibilityLabel="Recevoir"
                  >
                    <Icon name="arrow-down" size={26} color={COLORS.BITCOIN_ORANGE} />
                    <Text className="mt-2 text-sm font-semibold">{t("home.receive")}</Text>
                  </Pressable>

                  <Pressable
                    className="flex-1 items-center py-5 rounded-2xl bg-card"
                    onPress={() => navigation.navigate("Send", {})}
                    accessibilityRole="button"
                    accessibilityLabel="Envoyer"
                  >
                    <Icon name="arrow-up" size={26} color={COLORS.BITCOIN_ORANGE} />
                    <Text className="mt-2 text-sm font-semibold">{t("home.send")}</Text>
                  </Pressable>

                  <Pressable
                    className="flex-1 items-center py-5 rounded-2xl bg-card"
                    onPress={() => navigation.navigate("QRHub", { startScan: true })}
                    accessibilityRole="button"
                    accessibilityLabel="QR Thaï"
                  >
                    <Icon name="qr-code-outline" size={26} color={COLORS.BITCOIN_ORANGE} />
                    <Text className="mt-2 text-sm font-semibold">{t("home.thaiQr")}</Text>
                  </Pressable>
                </View>
                {vtxosToRefresh > 0 ? (
                  <Pressable
                    className="mt-3 flex-row items-center p-4 rounded-2xl"
                    style={{ backgroundColor: "#F7931A20", borderWidth: 1, borderColor: COLORS.BITCOIN_ORANGE, opacity: refreshForBanner.isPending ? 0.5 : 1 }}
                    onPress={() => refreshForBanner.mutate()}
                    disabled={refreshForBanner.isPending}
                    accessibilityRole="button"
                  >
                    <Icon name="refresh-circle-outline" size={26} color={COLORS.BITCOIN_ORANGE} />
                    <View className="ml-3 flex-1">
                      <Text className="text-base font-semibold">{t("vtxo.bannerTitle")}</Text>
                      <Text className="text-xs text-muted-foreground">{t("vtxo.bannerSub")}</Text>
                    </View>
                  </Pressable>
                ) : null}
                {getPendingOffers().length > 0 ? (
                  <Pressable
                    className="mt-3 flex-row items-center p-4 rounded-2xl"
                    style={{ backgroundColor: "#F7931A20", borderWidth: 1, borderColor: COLORS.BITCOIN_ORANGE }}
                    onPress={async () => {
                      const ids = getPendingOffers();
                      const id = ids[ids.length - 1];
                      try {
                        const o = await getOffer(id);
                        navigation.navigate("PayThaiQR", { qrData: o.qrCode, resumeOfferId: id });
                      } catch {}
                    }}
                    accessibilityRole="button"
                  >
                    <Icon name="time-outline" size={26} color={COLORS.BITCOIN_ORANGE} />
                    <View className="ml-3 flex-1">
                      <Text className="text-base font-semibold">{t("home.ongoing")}</Text>
                      <Text className="text-xs text-muted-foreground">{t("home.ongoingSub")}</Text>
                    </View>
                    <Icon name="chevron-forward" size={20} color="#888" />
                  </Pressable>
                ) : null}
                {takerMode ? (
                  <Pressable
                    className="mt-3 flex-row items-center p-4 rounded-2xl bg-card"
                    onPress={() => navigation.navigate("Earn")}
                    accessibilityRole="button"
                  >
                    <Icon name="cash-outline" size={26} color={COLORS.BITCOIN_ORANGE} />
                    <View className="ml-3 flex-1">
                      <Text className="text-base font-semibold">{t("earn.homeCard")}</Text>
                      <Text className="text-xs text-muted-foreground">{t("earn.homeCardSub")}</Text>
                    </View>
                    <Icon name="chevron-forward" size={20} color="#888" />
                  </Pressable>
                ) : null}
                {isOpen && (
                  <Animated.View entering={FadeInDown} exiting={FadeOutDown}>
                    <View className="p-4 rounded-lg bg-card mt-4 min-w-[300px]">
                      <Text className="text-lg font-bold mb-4 text-center">Balance Details</Text>

                      <View className="mb-4">
                        <View className="flex-row justify-between items-center mb-2">
                          <Text className="text-md font-bold">Onchain</Text>
                          <Text className="text-md font-bold">
                            {formatHomeBalance(onchainBalance)}
                          </Text>
                        </View>
                        <View className="pl-4 space-y-1">
                          <View className="flex-row justify-between">
                            <Text className="text-muted-foreground">Confirmed</Text>
                            <Text>{formatHomeBalance(balance?.onchain.confirmed ?? 0)}</Text>
                          </View>
                          <View className="flex-row justify-between">
                            <Text className="text-muted-foreground">Trusted Pending</Text>
                            <Text>{formatHomeBalance(balance?.onchain.trusted_pending ?? 0)}</Text>
                          </View>
                          <View className="flex-row justify-between">
                            <Text className="text-muted-foreground">Untrusted Pending</Text>
                            <Text>
                              {formatHomeBalance(balance?.onchain.untrusted_pending ?? 0)}
                            </Text>
                          </View>
                          <View className="flex-row justify-between">
                            <Text className="text-muted-foreground">Immature</Text>
                            <Text>{formatHomeBalance(balance?.onchain.immature ?? 0)}</Text>
                          </View>
                        </View>
                      </View>

                      <View>
                        <View className="flex-row justify-between items-center mb-2">
                          <Text className="text-md font-bold">Offchain</Text>
                          <Text className="text-md font-bold">
                            {formatHomeBalance(offchainBalance)}
                          </Text>
                        </View>
                        <View className="pl-4 space-y-1">
                          <View className="flex-row justify-between">
                            <Text className="text-muted-foreground">Spendable</Text>
                            <Text>{formatHomeBalance(balance?.offchain.spendable ?? 0)}</Text>
                          </View>
                          <View className="flex-row justify-between">
                            <Text className="text-muted-foreground">Pending Send</Text>
                            <Text>
                              {formatHomeBalance(balance?.offchain.pending_lightning_send ?? 0)}
                            </Text>
                          </View>
                          <View className="flex-row justify-between mb-2">
                            <Text className="text-muted-foreground">Pending In Round</Text>
                            <Text>
                              {formatHomeBalance(balance?.offchain.pending_in_round ?? 0)}
                            </Text>
                          </View>
                          <View className="flex-row justify-between">
                            <Text className="text-muted-foreground">Pending Exit</Text>
                            <Text>{formatHomeBalance(balance?.offchain.pending_exit ?? 0)}</Text>
                          </View>
                          <View className="flex-row justify-between">
                            <Text className="text-muted-foreground">Pending Board</Text>
                            <Text>{formatHomeBalance(balance?.offchain.pending_board ?? 0)}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  </Animated.View>
                )}
              </View>

              <View className="gap-4">
                <View className="rounded-[18px] border border-border/60 bg-card/70 px-4 py-4">
                  <View className="mb-3 flex-row items-center justify-between">
                    <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("home.activity")}</Text>
                    <Pressable onPress={openHistory}>
                      <Text className="text-sm font-semibold" style={{ color: COLORS.BITCOIN_ORANGE }}>{t("home.seeAll")}</Text>
                    </Pressable>
                  </View>

                  {isTransactionsLoading ? (
                    <View className="items-center py-6">
                      <NoahActivityIndicator size="small" />
                    </View>
                  ) : recentTransactions.length === 0 ? (
                    <View className="py-5">
                      <Text className="text-sm font-semibold text-foreground">{t("home.noActivity")}</Text>
                      <Text className="mt-1 text-sm text-muted-foreground">
                        {t("ui.068")}
                      </Text>
                    </View>
                  ) : (
                    recentTransactions.map((transaction, index) => (
                      <Pressable
                        key={transaction.id}
                        onPress={() => openTransaction(transaction)}
                        className={`flex-row items-center py-3 ${
                          index < recentTransactions.length - 1 ? "border-b border-border/60" : ""
                        }`}
                      >
                        <View className="mr-3 h-10 w-10 items-center justify-center rounded-full bg-background">
                          <Icon
                            name={getTransactionIcon(transaction.type)}
                            size={20}
                            color={transaction.direction === "outgoing" ? COLORS.BITCOIN_ORANGE : "#22c55e"}
                          />
                        </View>
                        <View className="min-w-0 flex-1">
                          <Text className="text-sm font-semibold text-foreground">
                            {getTransactionLabel(transaction)}
                          </Text>
                          <Text className="mt-1 text-xs text-muted-foreground">
                            {transaction.dateLabel ??
                              new Date(transaction.date).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                          </Text>
                        </View>
                        <Text
                          className={`text-sm font-bold ${
                            transaction.direction === "outgoing" ? "text-red-500" : "text-green-500"
                          }`}
                        >
                          {`${transaction.direction === "outgoing" ? "-" : "+"}${formatBitcoinAmount(transaction.amount)}`}
                        </Text>
                      </Pressable>
                    ))
                  )}
                </View>
              </View>
            </>
          )}
        </View>
        <View className="p-4 items-center justify-center mb-16" style={{ marginTop: "auto" }}>
        </View>
      </ScrollView>
      {selectedTransaction ? (
        <AppBottomSheet
          isOpen={isTransactionSheetOpen}
          onClose={() => setIsTransactionSheetOpen(false)}
          onDismiss={() => setSelectedTransaction(null)}
        >
          <TransactionDetailContent
            transaction={selectedTransaction}
            fiatCurrency={fiatCurrency}
            onClose={() => setIsTransactionSheetOpen(false)}
            closeIconName="close-outline"
          />
        </AppBottomSheet>
      ) : null}
    </NoahSafeAreaView>
  );
};

export default HomeScreen;
