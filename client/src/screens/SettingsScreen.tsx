import { t } from "~/lib/i18n";
import { isTakerModeEnabled, setTakerModeEnabled } from "~/lib/openpleb";
import { Linking, Pressable, ScrollView, View, Image } from "react-native";
import Constants from "expo-constants";
import { useWalletStore } from "../store/walletStore";
import { useBiometrics } from "../hooks/useBiometrics";
import { PLATFORM, shouldUseUnifiedPush } from "../constants";
import { useServerStore } from "../store/serverStore";
import { useTransactionStore } from "../store/transactionStore";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Text } from "../components/ui/text";
import React, { useState, useEffect, useRef } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { OnboardingStackParamList, SettingsStackParamList } from "../Navigators";
import Icon from "@react-native-vector-icons/ionicons";
import { useAutoBoardThreshold, useDeleteWallet, useSuspendWallet } from "../hooks/useWallet";
import { NoahSafeAreaView } from "~/components/NoahSafeAreaView";
import { ConfirmationDialog, DangerZoneRow } from "../components/ConfirmationDialog";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { AlertTriangle, CheckCircle } from "lucide-react-native";
import logoImageDark from "../../assets/thark/logo_qr.png";
import logoImageLight from "../../assets/thark/logo_light.png";
import { COLORS } from "~/lib/styleConstants";
import { useIconColor, useTheme } from "~/hooks/useTheme";
import { resetAndReRegisterWithServer } from "../lib/server";
import { useBottomTabBarHeight } from "react-native-bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { revokeMailboxAuthorization } from "~/lib/api";
import { AUTO_BOARD_ONCHAIN_BUFFER_AMOUNT, formatAutoBoardThreshold } from "~/lib/autoBoarding";
import { useProfileStore } from "~/store/profileStore";
import { getFiatCurrencyInfo } from "~/lib/fiatCurrency";
import { getBitcoinAmountUnitInfo } from "~/lib/bitcoinAmount";
import { NativeSwitch } from "~/components/ui/native-switch";
import { NativeNoahButton } from "~/components/ui/NativeNoahButton";

type Setting = {
  id:
    | "profile"
    | "currency"
    | "bitcoinUnit"
    | "showMnemonic"
    | "showLogs"
    | "resetRegistration"
    | "backup"
    | "arkInfo"
    | "vtxos"
    | "emergencyExit"
    | "feedback"
    | "unifiedPush"
    | "exportDatabase"
    | "debug";
  title: string;
  value?: string;
  description?: string;
  isPressable: boolean;
};

const SettingsScreen = () => {
  const iconColor = useIconColor();
  const { isDark } = useTheme();
  const logoImage = isDark ? logoImageDark : logoImageLight;
  const [confirmText, setConfirmText] = useState("");
  const [takerMode, setTakerMode] = useState(isTakerModeEnabled());
  const [isDeleteWalletDialogOpen, setIsDeleteWalletDialogOpen] = useState(false);
  const {
    isInitialized,
    setBiometricsEnabled,
    isDebugModeEnabled,
    setDebugModeEnabled,
    isWalletSuspended,
  } = useWalletStore();
  const { authenticate, checkAvailability, isBiometricsEnabled } = useBiometrics();
  const suspendWalletMutation = useSuspendWallet();
  const [versionTapCount, setVersionTapCount] = useState(0);
  const {
    isMailboxAuthorizationEnabled,
    setMailboxAuthorizationExpiry,
    setMailboxAuthorizationEnabled,
  } = useServerStore();
  const { isAutoBoardingEnabled, setAutoBoardingEnabled } = useTransactionStore();
  const preferredCurrency = useProfileStore((state) => state.preferredCurrency);
  const preferredCurrencyInfo = getFiatCurrencyInfo(preferredCurrency);
  const bitcoinAmountUnit = useProfileStore((state) => state.bitcoinAmountUnit);
  const bitcoinAmountUnitInfo = getBitcoinAmountUnitInfo(bitcoinAmountUnit);
  const {
    data: autoBoardThreshold,
    isError: isAutoBoardThresholdError,
    isLoading: isAutoBoardThresholdLoading,
  } = useAutoBoardThreshold(isInitialized);
  const [showResetSuccess, setShowResetSuccess] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [showMailboxSuccess, setShowMailboxSuccess] = useState(false);
  const [mailboxError, setMailboxError] = useState<string | null>(null);
  const [isMailboxTogglePending, setIsMailboxTogglePending] = useState(false);
  const [isBiometricsAvailable, setIsBiometricsAvailable] = useState(false);
  const deleteWalletMutation = useDeleteWallet();
  const tabBarHeight = useBottomTabBarHeight();
  const { bottom: safeBottomInset } = useSafeAreaInsets();

  const navigation =
    useNavigation<NativeStackNavigationProp<SettingsStackParamList & OnboardingStackParamList>>();

  const autoBoardDescription = isAutoBoardThresholdError
    ? t("set.autoTransferUnavail")
    : isAutoBoardThresholdLoading || autoBoardThreshold === undefined
      ? t("set.autoTransferLoading")
      : `Transférer vers Ark quand le solde onchain peut couvrir ${formatAutoBoardThreshold(autoBoardThreshold)}, les frais estimés et une réserve de ${formatAutoBoardThreshold(AUTO_BOARD_ONCHAIN_BUFFER_AMOUNT)}.`;

  useEffect(() => {
    const check = async () => {
      const { available } = await checkAvailability();
      setIsBiometricsAvailable(available);
    };
    check();
  }, [checkAvailability]);

  const versionTapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleVersionTap = () => {
    if (isDebugModeEnabled) return;

    if (versionTapTimeoutRef.current) {
      clearTimeout(versionTapTimeoutRef.current);
    }

    const newCount = versionTapCount + 1;
    setVersionTapCount(newCount);

    if (newCount >= 5) {
      setDebugModeEnabled(true);
      setVersionTapCount(0);
    } else {
      versionTapTimeoutRef.current = setTimeout(() => {
        setVersionTapCount(0);
      }, 2000);
    }
  };

  const handleSupportPress = () => {
    Linking.openURL("https://t.me/blixtwallet/605026");
  };

  const handleBiometricsToggle = async (value: boolean) => {
    const promptMessage = value
      ? t("set.authEnableBio")
      : t("set.authDisableBio");
    const result = await authenticate(promptMessage);
    if (result.isOk()) {
      setBiometricsEnabled(value);
    }
  };

  const handleMailboxAuthorizationToggle = async (value: boolean) => {
    if (isMailboxTogglePending) {
      return;
    }

    setMailboxError(null);
    setShowMailboxSuccess(false);
    setIsMailboxTogglePending(true);

    if (!value) {
      const result = await revokeMailboxAuthorization();
      if (result.isErr()) {
        setMailboxError(result.error.message || "Failed to revoke mailbox authorization");
        setTimeout(() => {
          setMailboxError(null);
        }, 3000);
        setIsMailboxTogglePending(false);
        return;
      }

      setMailboxAuthorizationExpiry(null);
    }

    setMailboxAuthorizationEnabled(value);
    setShowMailboxSuccess(true);
    setTimeout(() => {
      setShowMailboxSuccess(false);
    }, 3000);
    setIsMailboxTogglePending(false);
  };

  const handlePress = (item: Setting) => {
    if (!item.isPressable) return;

    if (item.id === "profile") {
      navigation.navigate("Profile");
    } else if (item.id === "currency") {
      navigation.navigate("Currency");
    } else if (item.id === "bitcoinUnit") {
      navigation.navigate("BitcoinUnit");
    } else if (item.id === "showMnemonic") {
      navigation.navigate("Mnemonic", { fromOnboarding: false });
    } else if (item.id === "showLogs") {
      navigation.navigate("Logs");
    } else if (item.id === "resetRegistration") {
      // This is handled by the AlertDialog now
    } else if (item.id === "backup") {
      navigation.navigate("BackupSettings");
    } else if (item.id === "arkInfo") {
      navigation.navigate("ArkInfo");
    } else if (item.id === "vtxos") {
      navigation.navigate("VTXOs");
    } else if (item.id === "emergencyExit") {
      navigation.navigate("UnilateralExit");
    } else if (item.id === "feedback") {
      navigation.navigate("Feedback");
    } else if (item.id === "unifiedPush") {
      navigation.navigate("UnifiedPush", { fromOnboarding: false });
    } else if (item.id === "exportDatabase") {
      navigation.navigate("ExportDatabase");
    } else if (item.id === "debug") {
      navigation.navigate("Debug");
    }
  };

  const profileData: Setting[] = [];
  const infoData: Setting[] = [];
  const walletData: Setting[] = [];
  const debugData: Setting[] = [];

  if (isInitialized) {
    profileData.push({
      id: "profile",
      title: t("set.profile"),
      description: t("set.profileDesc"),
      isPressable: true,
    });
    profileData.push({
      id: "currency",
      title: t("set.currency"),
      value: `${preferredCurrencyInfo.code} · ${preferredCurrencyInfo.name}`,
      description: t("set.currencyDesc"),
      isPressable: true,
    });
    profileData.push({
      id: "bitcoinUnit",
      title: t("set.bitcoinUnit"),
      value: `${bitcoinAmountUnitInfo.title} · ${bitcoinAmountUnitInfo.value}`,
      description: t("set.bitcoinUnitDesc"),
      isPressable: true,
    });

    infoData.push({
      id: "arkInfo",
      title: t("set.arkInfo"),
      description: t("set.arkInfoDesc"),
      isPressable: true,
    });
  }

  if (isInitialized) {
    walletData.push({
      id: "showMnemonic",
      title: t("set.showMnemonic"),
      description:
        t("set.mnemonicWarn"),
      isPressable: true,
    });
    walletData.push({
      id: "vtxos",
      title: t("set.showVtxos"),
      description: t("set.vtxosDesc"),
      isPressable: true,
    });
    walletData.push({
      id: "emergencyExit",
      title: t("set.emergencyExit"),
      description: t("set.emergencyExitDesc"),
      isPressable: true,
    });
    walletData.push({
      id: "backup",
      title: t("set.backup"),
      description: t("set.backupDesc"),
      isPressable: true,
    });

    /* UnifiedPush retiré (Thârk) */

    /* debugData vidé (Thârk : strict minimum) */
  }

  const renderSettingItem = (item: Setting) => {
    if (item.id === "resetRegistration") {
      return (
        <ConfirmationDialog
          key={item.id}
          trigger={
            <DangerZoneRow
              title={item.title}
              description={t("set.resetAttemptDesc")}
              isPressable={item.isPressable}
              onPress={() => {}}
            />
          }
          title={t("ui.090")}
          description={t("set.resetConfirm")}
          onConfirm={async () => {
            setResetError(null);
            setShowResetSuccess(false);
            const result = await resetAndReRegisterWithServer();
            if (result.isOk()) {
              setShowResetSuccess(true);
              setTimeout(() => {
                setShowResetSuccess(false);
              }, 3000);
            } else {
              setResetError(result.error.message || "Failed to reset registration");
              setTimeout(() => {
                setResetError(null);
              }, 3000);
            }
          }}
        />
      );
    }
    return (
      <Pressable
        key={item.id}
        onPress={() => handlePress(item)}
        disabled={!item.isPressable}
        className="flex-row justify-between items-center p-4 border-b border-border bg-card rounded-lg mb-2"
      >
        <View className="flex-1">
          <Label className="text-foreground text-lg">{item.title}</Label>
          {item.value && <Text className="text-muted-foreground text-base mt-1">{item.value}</Text>}
          {item.description && (
            <Text className="text-muted-foreground text-base mt-1">{item.description}</Text>
          )}
        </View>
        {item.isPressable && <Icon name="chevron-forward-outline" size={24} color={iconColor} />}
      </Pressable>
    );
  };

  return (
    <NoahSafeAreaView className="flex-1 bg-background" style={{ paddingBottom: 0 }}>
      <View className="px-4 pt-4">
        <View className="flex-row items-center mb-4">
          <Pressable onPress={() => navigation.goBack()} className="mr-4">
            <Icon name="arrow-back-outline" size={24} color={iconColor} />
          </Pressable>
          <Text className="text-2xl font-bold text-foreground">{t("set.title")}</Text>
        </View>

        {showResetSuccess && (
          <Alert icon={CheckCircle} className="mb-4">
            <AlertTitle>{t("set.success")}</AlertTitle>
            <AlertDescription>{t("set.resetDone")}</AlertDescription>
          </Alert>
        )}
        {resetError && (
          <Alert icon={AlertTriangle} variant="destructive" className="mb-4">
            <AlertTitle>{t("set.resetFailed")}</AlertTitle>
            <AlertDescription>{resetError}</AlertDescription>
          </Alert>
        )}
        {showMailboxSuccess && (
          <Alert icon={CheckCircle} className="mb-4">
            <AlertTitle>{t("set.mailboxUpdated")}</AlertTitle>
            <AlertDescription>
              {isMailboxAuthorizationEnabled
                ? t("set.mailboxGranted")
                : t("set.mailboxRevoked")}
            </AlertDescription>
          </Alert>
        )}
        {mailboxError && (
          <Alert icon={AlertTriangle} variant="destructive" className="mb-4">
            <AlertTitle>{t("set.mailboxFailed")}</AlertTitle>
            <AlertDescription>{mailboxError}</AlertDescription>
          </Alert>
        )}
      </View>
      <ScrollView
        className="flex-1 px-4"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: safeBottomInset + (PLATFORM === "android" ? 0 : tabBarHeight),
        }}
      >
        <View className="items-center mb-6">
          <Image
            source={logoImage}
            style={{ width: 120, height: 120, borderRadius: 12 }}
            resizeMode="contain"
          />
        </View>

        {profileData.length > 0 && (
          <View className="mb-6">
            <Text
              className="text-lg font-bold text-foreground mb-2"
              style={{ color: COLORS.BITCOIN_ORANGE }}
            >
              {t("set.sectionAccount")}
            </Text>
            {profileData.map(renderSettingItem)}
          </View>
        )}

        {infoData.length > 0 && (
          <View className="mb-6">
            <Text
              className="text-lg font-bold text-foreground mb-2"
              style={{ color: COLORS.BITCOIN_ORANGE }}
            >
              {t("set.sectionInfo")}
            </Text>
            {infoData.map(renderSettingItem)}
          </View>
        )}

        {walletData.length > 0 && (
          <View className="mb-6">
            <Text
              className="text-lg font-bold text-foreground mb-2"
              style={{ color: COLORS.BITCOIN_ORANGE }}
            >
              {t("set.sectionWallet")}
            </Text>
            {walletData.map(renderSettingItem)}
            <View className="p-4 border-b border-border bg-card rounded-lg mb-2 flex-row justify-between items-center">
              <View className="flex-1">
                <Label className="text-foreground text-lg">{t("set.autoTransfer")}</Label>
                <Text className="text-base mt-1 text-muted-foreground">{autoBoardDescription}</Text>
              </View>
              <NativeSwitch value={isAutoBoardingEnabled} onValueChange={setAutoBoardingEnabled} />
            </View>
            {isBiometricsAvailable && (
              <View className="p-4 border-b border-border bg-card rounded-lg mb-2 flex-row justify-between items-center">
                <View className="flex-1">
                  <Label className="text-foreground text-lg">{t("set.biometricAuth")}</Label>
                  <Text className="text-base mt-1 text-muted-foreground">
                    {t("set.biometricDesc")}
                  </Text>
                </View>
                <NativeSwitch value={isBiometricsEnabled} onValueChange={handleBiometricsToggle} />
              </View>
            )}
            <View className="p-4 border-b border-border bg-card rounded-lg mb-2 flex-row justify-between items-center">
              <View className="flex-1">
                <Label className="text-foreground text-lg">{t("set.takerMode")}</Label>
                <Text className="text-base mt-1 text-muted-foreground">{t("set.takerModeDesc")}</Text>
              </View>
              <NativeSwitch
                value={takerMode}
                onValueChange={(v: boolean) => { setTakerModeEnabled(v); setTakerMode(v); }}
              />
            </View>
            <View className="p-4 border-b border-border bg-card rounded-lg mb-2 flex-row justify-between items-center">
              <View className="flex-1">
                <Label className="text-foreground text-lg">{t("set.mailboxNotif")}</Label>
                <Text className="text-base mt-1 text-muted-foreground">
                  {t("set.mailboxDesc")}
                </Text>
              </View>
              <NativeSwitch
                value={isMailboxAuthorizationEnabled}
                onValueChange={handleMailboxAuthorizationToggle}
                disabled={isMailboxTogglePending}
              />
            </View>
          </View>
        )}

        {debugData.length > 0 && (
          <View className="mb-6">
            <Text
              className="text-lg font-bold text-foreground mb-2"
              style={{ color: COLORS.BITCOIN_ORANGE }}
            >
              {t("set.sectionDebug")}
            </Text>
            {debugData.map(renderSettingItem)}
          </View>
        )}

        {isInitialized && (
          <View className="mb-6">
            <Text className="text-lg font-bold text-destructive mb-2">{t("set.sensitiveZone")}</Text>

            <View className="p-4 border-b border-border bg-card rounded-lg mb-4 flex-row justify-between items-center">
              <View className="flex-1">
                <Label className="text-foreground text-lg">{t("set.suspendWallet")}</Label>
                <Text className="text-base mt-1 text-muted-foreground">
                  {t("set.suspendDesc")}
                </Text>
              </View>
              <NativeSwitch
                value={isWalletSuspended}
                onValueChange={(value) => suspendWalletMutation.mutate(value)}
                disabled={suspendWalletMutation.isPending}
                tone="destructive"
              />
            </View>

            <DangerZoneRow
              title={t("set.exportDb")}
              description={t("set.exportDbDesc")}
              isPressable
              onPress={() => navigation.navigate("ExportDatabase")}
            />

            <NativeNoahButton
              label={t("set.deleteWallet")}
              variant="destructive"
              onPress={() => setIsDeleteWalletDialogOpen(true)}
              fullWidth
            />
            <ConfirmationDialog
              open={isDeleteWalletDialogOpen}
              onOpenChange={(open) => {
                setIsDeleteWalletDialogOpen(open);
                if (!open) {
                  setConfirmText("");
                }
              }}
              title={t("set.deleteWallet")}
              description={`This action is irreversible. To confirm, please type "delete" in the box below.`}
              onConfirm={() => {
                if (confirmText.toLowerCase() === "delete") {
                  deleteWalletMutation.mutate();
                  setIsDeleteWalletDialogOpen(false);
                  setConfirmText("");
                }
              }}
              isConfirmDisabled={confirmText.toLowerCase() !== "delete"}
            >
              <Input
                value={confirmText}
                onChangeText={setConfirmText}
                placeholder='Type "delete" to confirm'
                className="h-12"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </ConfirmationDialog>
          </View>
        )}

        <View className="items-center py-8 px-4">
          <Pressable onPress={handleVersionTap}>
            <Text className="text-muted-foreground text-sm mb-1">
              v{Constants.expoConfig?.version || "0.0.1"}
              {versionTapCount > 0 &&
                versionTapCount < 5 &&
                ` (${5 - versionTapCount} taps to unlock debug)`}
              {isDebugModeEnabled && " 🔧"}
            </Text>
          </Pressable>
          <Pressable onPress={handleSupportPress} className="mb-1">
            <Text className="text-muted-foreground text-sm text-center">
              For support, reach us on{" "}
              <Text className="text-sm font-semibold" style={{ color: COLORS.BITCOIN_ORANGE }}>
                Telegram
              </Text>
            </Text>
          </Pressable>
          <Text className="text-muted-foreground text-sm">{t("set.madeWith")}</Text>
        </View>
      </ScrollView>
    </NoahSafeAreaView>
  );
};

export default SettingsScreen;
